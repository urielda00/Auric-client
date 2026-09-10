import { create } from 'zustand';
import { audioEngine } from '../services/audio';
import { useQueueStore } from './useQueueStore';
import { useLibraryStore } from './useLibraryStore';
import { recommendationService } from '../services/recommendationService';
import { loadJSON, saveJSON, STORAGE_KEYS } from '../services/storage';

const { isTrackPlayable } = require('../services/trackMapper.cjs');

/**
 * Central player slice. Everything the Mini Player, Full Player and Queue sheet render
 * comes from here; all of them drive playback through `audioEngine` (currently
 * MockAudioEngine) so a future real engine is a one-line swap in services/audio/index.js.
 *
 * Deliberately mirrors the approved design's queue model: `next()` pulls from the queue
 * head; playing a track from Search/History/Quick Picks/History never rewrites the queue,
 * only Liked Songs and the two Shuffle modes do. Reaching the end of a Liked Songs queue
 * stops playback rather than continuing into the wider library.
 */

const PERSIST_INTERVAL_MS = 5000;
const RESTART_THRESHOLD_MS = 4000;
const PLAYED_STACK_LIMIT = 50;

let lastPersistAt = 0;

function contextFor(type, label) {
  return { type, label };
}

export const usePlayerStore = create((set, get) => ({
  currentTrackId: null,
  isPlaying: false,
  positionMs: 0,
  durationMs: 0,
  playbackContext: contextFor('none', ''),
  shuffleMode: null,
  playedStack: [],
  hydrated: false,

  async hydrate() {
    audioEngine.setOnProgress((ms) => {
      set({ positionMs: ms });
      const now = Date.now();
      if (now - lastPersistAt > PERSIST_INTERVAL_MS) {
        persistSession(get());
        lastPersistAt = now;
      }
    });
    audioEngine.setOnEnded(() => {
      get().next();
    });

    const session = await loadJSON(STORAGE_KEYS.currentTrack, null);
    if (session?.trackId) {
      const track = useLibraryStore.getState().getTrackById(session.trackId);
      if (track) {
        audioEngine.load(track);
        audioEngine.seekTo(session.positionMs || 0);
        set({
          currentTrackId: session.trackId,
          positionMs: session.positionMs || 0,
          durationMs: track.durationMs,
          isPlaying: false,
          playbackContext: session.context || contextFor('none', ''),
          shuffleMode: session.shuffleMode || null,
        });
      }
    }
    set({ hydrated: true });
  },

  getCurrentTrack() {
    const { currentTrackId } = get();
    return currentTrackId ? useLibraryStore.getState().getTrackById(currentTrackId) : null;
  },

  /** Plays a specific track. Removes it from the queue if present; queue is otherwise untouched. */
  play(trackId, context) {
    const track = useLibraryStore.getState().getTrackById(trackId);
    if (!track || !isTrackPlayable(track)) return;
    useQueueStore.getState().removeId(trackId);
    activate(set, get, track, context || get().playbackContext, { pushCurrentToStack: true });
  },

  toggle() {
    const { isPlaying } = get();
    if (isPlaying) {
      audioEngine.pause();
      set({ isPlaying: false });
    } else {
      if (!get().currentTrackId) return;
      audioEngine.play();
      set({ isPlaying: true });
    }
    persistSession(get());
  },

  seek(ms) {
    audioEngine.seekTo(ms);
    set({ positionMs: ms });
    persistSession(get());
  },

  previous() {
    const { positionMs, playedStack, currentTrackId } = get();
    if (positionMs > RESTART_THRESHOLD_MS || !playedStack.length) {
      audioEngine.seekTo(0);
      set({ positionMs: 0 });
      persistSession(get());
      return;
    }
    const prevId = playedStack[playedStack.length - 1];
    const track = useLibraryStore.getState().getTrackById(prevId);
    if (!track) return;
    set({ playedStack: playedStack.slice(0, -1) });
    if (currentTrackId) useQueueStore.getState().enqueueNext(currentTrackId);
    activate(set, get, track, get().playbackContext, { pushCurrentToStack: false });
  },

  async next() {
    const headId = useQueueStore.getState().shift();
    if (headId) {
      const track = useLibraryStore.getState().getTrackById(headId);
      if (track) {
        activate(set, get, track, get().playbackContext, { pushCurrentToStack: true });
        return;
      }
    }
    const { playbackContext, shuffleMode, currentTrackId } = get();
    if (playbackContext.type === 'liked') {
      audioEngine.pause();
      set({ isPlaying: false });
      persistSession(get());
      return;
    }
    // Queue ran dry outside Liked Songs — keep the music going with a fresh batch.
    const batch =
      shuffleMode === 'random'
        ? await recommendationService.getRandomShuffleQueue(12)
        : await recommendationService.getSmartShuffleQueue(12);
    const filtered = batch.filter((t) => t.id !== currentTrackId).slice(0, 12);
    if (!filtered.length) return;
    const [first, ...rest] = filtered;
    useQueueStore.getState().setFrom(rest.map((t) => t.id));
    activate(set, get, first, playbackContext, { pushCurrentToStack: true });
  },

  async startSmartShuffle() {
    const batch = await recommendationService.getSmartShuffleQueue(20);
    if (!batch.length) return;
    const [first, ...rest] = batch;
    useQueueStore.getState().setFrom(rest.map((t) => t.id));
    set({ shuffleMode: 'smart' });
    activate(set, get, first, contextFor('smartShuffle', 'Smart Shuffle'), { pushCurrentToStack: true });
  },

  async startRandomShuffle() {
    const batch = await recommendationService.getRandomShuffleQueue(20);
    if (!batch.length) return;
    const [first, ...rest] = batch;
    useQueueStore.getState().setFrom(rest.map((t) => t.id));
    set({ shuffleMode: 'random' });
    activate(set, get, first, contextFor('randomShuffle', 'Random Shuffle'), { pushCurrentToStack: true });
  },

  /** Starts playback of the Liked Songs set, in order. Ending the queue stops playback. */
  playLikedSongs(likedTrackIds) {
    if (!likedTrackIds.length) return;
    const [first, ...rest] = likedTrackIds;
    const track = useLibraryStore.getState().getTrackById(first);
    if (!track) return;
    useQueueStore.getState().setFrom(rest);
    set({ shuffleMode: null });
    activate(set, get, track, contextFor('liked', 'Liked Songs'), { pushCurrentToStack: true });
  },

  /** Shuffles Liked Songs only; the resulting queue never leaves this set. */
  shuffleLikedSongs(likedTrackIds) {
    if (!likedTrackIds.length) return;
    const shuffled = [...likedTrackIds].sort(() => Math.random() - 0.5);
    const [first, ...rest] = shuffled;
    const track = useLibraryStore.getState().getTrackById(first);
    if (!track) return;
    useQueueStore.getState().setFrom(rest);
    set({ shuffleMode: null });
    activate(set, get, track, contextFor('liked', 'Liked Songs · Shuffle'), { pushCurrentToStack: true });
  },

  /** Flushes the current session to disk immediately — call on app background/inactive. */
  persistNow() {
    persistSession(get());
  },
}));

function activate(set, get, track, context, { pushCurrentToStack }) {
  if (!isTrackPlayable(track)) return;
  const prevId = get().currentTrackId;
  audioEngine.load(track);
  audioEngine.play();
  set((state) => ({
    currentTrackId: track.id,
    positionMs: 0,
    durationMs: track.durationMs,
    isPlaying: true,
    playbackContext: context,
    playedStack:
      pushCurrentToStack && prevId && prevId !== track.id
        ? [...state.playedStack, prevId].slice(-PLAYED_STACK_LIMIT)
        : state.playedStack,
  }));
  useLibraryStore.getState().recordPlay(track.id);
  persistSession(get());
  lastPersistAt = Date.now();
}

function persistSession(state) {
  saveJSON(STORAGE_KEYS.currentTrack, {
    trackId: state.currentTrackId,
    positionMs: state.positionMs,
    context: state.playbackContext,
    shuffleMode: state.shuffleMode,
  });
}

export default usePlayerStore;
