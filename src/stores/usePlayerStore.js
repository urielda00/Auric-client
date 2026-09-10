import { create } from "zustand";
import { audioEngine } from "../services/audio";
import { useQueueStore } from "./useQueueStore";
import { useLibraryStore } from "./useLibraryStore";
import { recommendationService } from "../services/recommendationService";
import { loadJSON, saveJSON, STORAGE_KEYS } from "../services/storage";

const { isTrackPlayable } = require("../services/trackMapper.cjs");
const {
  createCompletionHandler,
  isCurrentPlaybackEvent,
  normalizeRestoredPosition,
  takeNextPlayable,
} = require("../services/audio/playbackPolicy.cjs");

const PERSIST_INTERVAL_MS = 5000;
const RESTART_THRESHOLD_MS = 4000;
const PLAYED_STACK_LIMIT = 50;

let lastPersistAt = 0;
let activationSequence = 0;

function contextFor(type, label) {
  return { type, label };
}

function playbackFailureMessage() {
  return "Unable to play this track. Check your connection and try again.";
}

export const usePlayerStore = create((set, get) => ({
  currentTrackId: null,
  isPlaying: false,
  positionMs: 0,
  durationMs: 0,
  isBuffering: false,
  isLoading: false,
  playbackError: null,
  playbackContext: contextFor("none", ""),
  shuffleMode: null,
  playedStack: [],
  hydrated: false,

  async hydrate() {
    audioEngine.setOnStatus((status) => {
      if (!isCurrentPlaybackEvent(status, get().currentTrackId)) return;
      const currentDuration = get().durationMs;
      set({
        positionMs: status.positionMs,
        durationMs: status.durationMs > 0 ? status.durationMs : currentDuration,
        isPlaying: status.isPlaying,
        isBuffering: status.isBuffering,
        isLoading: !status.isLoaded && !status.error,
        playbackError: status.error ? playbackFailureMessage() : null,
      });
      const now = Date.now();
      if (now - lastPersistAt > PERSIST_INTERVAL_MS) {
        persistSession(get());
        lastPersistAt = now;
      }
    });
    audioEngine.setOnEnded(
      createCompletionHandler({
        getCurrentTrackId: () => get().currentTrackId,
        next: () => get().next(),
      }),
    );

    const session = await loadJSON(STORAGE_KEYS.currentTrack, null);
    if (session?.trackId) {
      const track = useLibraryStore.getState().getTrackById(session.trackId);
      if (track && isTrackPlayable(track)) {
        const positionMs = normalizeRestoredPosition(
          session.positionMs,
          track.durationMs,
        );
        set({
          currentTrackId: session.trackId,
          positionMs,
          durationMs: track.durationMs || 0,
          isPlaying: false,
          isLoading: true,
          playbackError: null,
          playbackContext: session.context || contextFor("none", ""),
          shuffleMode: session.shuffleMode || null,
        });
        try {
          await audioEngine.load(track);
          await audioEngine.seekTo(positionMs);
        } catch {
          set({
            isLoading: false,
            isBuffering: false,
            playbackError: playbackFailureMessage(),
          });
        }
      }
    }
    set({ hydrated: true, isPlaying: false });
  },

  getCurrentTrack() {
    const { currentTrackId } = get();
    return currentTrackId
      ? useLibraryStore.getState().getTrackById(currentTrackId)
      : null;
  },

  async play(trackId, context) {
    const track = useLibraryStore.getState().getTrackById(trackId);
    if (!track || !isTrackPlayable(track)) return;
    useQueueStore.getState().removeId(trackId);
    await activate(set, get, track, context || get().playbackContext, {
      pushCurrentToStack: true,
    });
  },

  async toggle() {
    if (!get().currentTrackId) return;
    if (get().playbackError) {
      await get().retry();
      return;
    }
    if (get().isPlaying) {
      try {
        await audioEngine.pause();
      } catch {
        set({ playbackError: playbackFailureMessage(), isPlaying: false });
      }
    } else {
      try {
        await audioEngine.play();
      } catch {
        set({ playbackError: playbackFailureMessage(), isPlaying: false });
      }
    }
    persistSession(get());
  },

  async seek(ms) {
    const value = Math.max(0, Math.min(get().durationMs, Math.round(ms)));
    try {
      await audioEngine.seekTo(value);
      if (get().currentTrackId) {
        set({ positionMs: value, playbackError: null });
      }
    } catch {
      set({ playbackError: playbackFailureMessage() });
    }
    persistSession(get());
  },

  async previous() {
    const { positionMs, playedStack, currentTrackId } = get();
    if (positionMs > RESTART_THRESHOLD_MS || !playedStack.length) {
      await get().seek(0);
      return;
    }
    const prevId = playedStack[playedStack.length - 1];
    const track = useLibraryStore.getState().getTrackById(prevId);
    if (!track || !isTrackPlayable(track)) return;
    set({ playedStack: playedStack.slice(0, -1) });
    if (currentTrackId) useQueueStore.getState().enqueueNext(currentTrackId);
    await activate(set, get, track, get().playbackContext, {
      pushCurrentToStack: false,
    });
  },

  async next() {
    const track = takeNextPlayable({
      shift: () => useQueueStore.getState().shift(),
      getTrack: (id) => useLibraryStore.getState().getTrackById(id),
      isPlayable: isTrackPlayable,
    });
    if (track) {
      await activate(set, get, track, get().playbackContext, {
        pushCurrentToStack: true,
      });
      return;
    }
    try {
      await audioEngine.pause();
    } catch {
      set({ playbackError: playbackFailureMessage() });
    }
    set({ isPlaying: false, isBuffering: false, isLoading: false });
    persistSession(get());
  },

  async startSmartShuffle() {
    const batch = (await recommendationService.getSmartShuffleQueue(20)).filter(
      isTrackPlayable,
    );
    if (!batch.length) return;
    const [first, ...rest] = batch;
    useQueueStore.getState().setFrom(rest.map((track) => track.id));
    set({ shuffleMode: "smart" });
    await activate(
      set,
      get,
      first,
      contextFor("smartShuffle", "Smart Shuffle"),
      { pushCurrentToStack: true },
    );
  },

  async startRandomShuffle() {
    const batch = (
      await recommendationService.getRandomShuffleQueue(20)
    ).filter(isTrackPlayable);
    if (!batch.length) return;
    const [first, ...rest] = batch;
    useQueueStore.getState().setFrom(rest.map((track) => track.id));
    set({ shuffleMode: "random" });
    await activate(
      set,
      get,
      first,
      contextFor("randomShuffle", "Random Shuffle"),
      { pushCurrentToStack: true },
    );
  },

  async playLikedSongs(likedTrackIds) {
    const playable = likedTrackIds.filter((id) =>
      isTrackPlayable(useLibraryStore.getState().getTrackById(id)),
    );
    if (!playable.length) return;
    const [first, ...rest] = playable;
    const track = useLibraryStore.getState().getTrackById(first);
    useQueueStore.getState().setFrom(rest);
    set({ shuffleMode: null });
    await activate(set, get, track, contextFor("liked", "Liked Songs"), {
      pushCurrentToStack: true,
    });
  },

  async shuffleLikedSongs(likedTrackIds) {
    const shuffled = likedTrackIds
      .filter((id) =>
        isTrackPlayable(useLibraryStore.getState().getTrackById(id)),
      )
      .sort(() => Math.random() - 0.5);
    if (!shuffled.length) return;
    const [first, ...rest] = shuffled;
    const track = useLibraryStore.getState().getTrackById(first);
    useQueueStore.getState().setFrom(rest);
    set({ shuffleMode: null });
    await activate(
      set,
      get,
      track,
      contextFor("liked", "Liked Songs · Shuffle"),
      { pushCurrentToStack: true },
    );
  },

  async retry() {
    const track = get().getCurrentTrack();
    if (!track || !isTrackPlayable(track)) return;
    await activate(set, get, track, get().playbackContext, {
      pushCurrentToStack: false,
    });
  },

  persistNow() {
    persistSession(get());
  },
}));

async function activate(set, get, track, context, { pushCurrentToStack }) {
  if (!isTrackPlayable(track)) return;
  const operation = ++activationSequence;
  const prevId = get().currentTrackId;
  set((state) => ({
    currentTrackId: track.id,
    positionMs: 0,
    durationMs: track.durationMs || 0,
    isPlaying: false,
    isBuffering: true,
    isLoading: true,
    playbackError: null,
    playbackContext: context,
    playedStack:
      pushCurrentToStack && prevId && prevId !== track.id
        ? [...state.playedStack, prevId].slice(-PLAYED_STACK_LIMIT)
        : state.playedStack,
  }));
  try {
    await audioEngine.load(track);
    if (operation !== activationSequence) return;
    await audioEngine.play();
    if (operation !== activationSequence) return;
    persistSession(get());
    lastPersistAt = Date.now();
  } catch {
    if (operation === activationSequence) {
      set({
        isPlaying: false,
        isBuffering: false,
        isLoading: false,
        playbackError: playbackFailureMessage(),
      });
      persistSession(get());
    }
  }
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
