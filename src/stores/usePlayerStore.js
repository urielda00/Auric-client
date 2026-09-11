import { create } from "zustand";
import { audioEngine } from "../services/audio";
import {
  setQueueMutationHandler,
  setQueuePersistenceHandler,
  useQueueStore,
} from "./useQueueStore";
import { useLibraryStore } from "./useLibraryStore";
import { recommendationService } from "../services/recommendationService";
import { loadJSON, saveJSON, STORAGE_KEYS } from "../services/storage";
import { listeningService } from "../services/listeningService";
import { generateUuid } from "../utils/id";
import { playbackStateService } from "../services/playbackStateService";

const { isTrackPlayable } = require("../services/trackMapper.cjs");
const {
  createCompletionHandler,
  isCurrentPlaybackEvent,
  normalizeRestoredPosition,
  takeNextPlayable,
} = require("../services/audio/playbackPolicy.cjs");
const {
  createListeningSessionTracker,
} = require("../services/listeningSessionTracker.cjs");
const {
  restorePlaybackSnapshot,
} = require("../services/audio/playbackRestore.cjs");
const {
  createCheckpointGate,
} = require("../services/audio/checkpointPolicy.cjs");
const {
  createRecommendationRequestCoordinator,
} = require("../services/recommendationApi.cjs");
const {
  prepareRecommendationPlayback,
} = require("../services/recommendationPlayback.cjs");
const {
  DEFAULT_QUEUE_TARGET,
  createQueueRefillCoordinator,
  startDirectPlayback,
  takeNextWithEmergency,
} = require("../services/playbackQueuePolicy.cjs");

const CHECKPOINT_INTERVAL_MS = 15000;
const RESTART_THRESHOLD_MS = 4000;
const PLAYED_STACK_LIMIT = 50;

const checkpointGate = createCheckpointGate(CHECKPOINT_INTERVAL_MS);
let activationSequence = 0;
const recommendationRequests = createRecommendationRequestCoordinator();
let queueRefillCoordinator = null;

function contextFor(type, label) {
  return { type, label };
}

function playbackFailureMessage() {
  return "Unable to play this track. Check your connection and try again.";
}

const listeningTracker = createListeningSessionTracker({
  api: listeningService,
  enabled: listeningService.enabled,
  createId: generateUuid,
  storage: {
    load: () => loadJSON(STORAGE_KEYS.pendingListeningSessions, []),
    save: (sessions) =>
      saveJSON(STORAGE_KEYS.pendingListeningSessions, sessions),
  },
  onStarted: (trackId) => {
    if (!listeningService.enabled) {
      useLibraryStore.getState().recordPlay(trackId);
    }
  },
});

export const usePlayerStore = create((set, get) => ({
  currentTrackId: null,
  currentItemId: null,
  isPlaying: false,
  positionMs: 0,
  durationMs: 0,
  isBuffering: false,
  isLoading: false,
  playbackError: null,
  playbackContext: contextFor("none", ""),
  shuffleMode: null,
  shufflePending: null,
  shuffleError: null,
  playedStack: [],
  playedItems: [],
  hydrated: false,

  async hydrate() {
    setQueuePersistenceHandler(() => {
      void persistPlaybackState(get(), "replace");
    });
    setQueueMutationHandler(() => {
      void get().ensureQueueDepth();
    });
    playbackStateService.setConflictHandler((snapshot) =>
      applyRestoredSnapshot(set, get, snapshot),
    );
    audioEngine.setOnStatus((status) => {
      if (!isCurrentPlaybackEvent(status, get().currentTrackId)) return;
      listeningTracker.handleStatus(status, get().playbackContext);
      const currentDuration = get().durationMs;
      const hadPlaybackError = Boolean(get().playbackError);
      set({
        positionMs: status.positionMs,
        durationMs: status.durationMs > 0 ? status.durationMs : currentDuration,
        isPlaying: status.isPlaying,
        isBuffering: status.isBuffering,
        isLoading: !status.isLoaded && !status.error,
        playbackError: status.error ? playbackFailureMessage() : null,
      });
      const now = Date.now();
      if (
        checkpointGate.shouldCheckpoint({
          nowMs: now,
          isPlaying: status.isPlaying,
        })
      ) {
        void persistPlaybackState(get(), "checkpoint");
      }
      if (status.error && !hadPlaybackError) {
        void persistPlaybackState(get(), "checkpoint");
      }
    });
    audioEngine.setOnEnded(
      createCompletionHandler({
        getCurrentTrackId: () => get().currentTrackId,
        next: () => get().next("completed"),
      }),
    );

    await listeningTracker.recoverPending();
    const restored = await playbackStateService.hydrate();
    if (restored.snapshot && restored.source !== "local-stale-hydration") {
      await applyRestoredSnapshot(set, get, restored.snapshot);
    }
    set({ hydrated: true, isPlaying: false });
    void get().ensureQueueDepth();
  },

  getCurrentTrack() {
    const { currentTrackId } = get();
    return currentTrackId
      ? useLibraryStore.getState().getTrackById(currentTrackId)
      : null;
  },

  async play(trackId, context, queueItemId) {
    const track = useLibraryStore.getState().getTrackById(trackId);
    if (!track || !isTrackPlayable(track)) return;
    recommendationRequests.invalidate();
    getQueueRefillCoordinator().invalidate({ refillAfterPending: true });
    set({ shuffleMode: null, shufflePending: null, shuffleError: null });
    playbackStateService.markLocalChange();
    return startDirectPlayback({
      resetQueue: () =>
        useQueueStore.getState().clear({ persist: false, refill: false }),
      activate: () =>
        activate(
          set,
          get,
          track,
          context || contextFor("direct", "Library"),
          {
            pushCurrentToStack: true,
            endPreviousReason: "replaced",
            currentItemId: queueItemId,
          },
        ),
      refill: () => get().ensureQueueDepth(),
    });
  },

  async playQueued(trackId, context, queueItemId) {
    const track = useLibraryStore.getState().getTrackById(trackId);
    if (!track || !isTrackPlayable(track)) return false;
    playbackStateService.markLocalChange();
    const activated = await activate(
      set,
      get,
      track,
      context || contextFor("manual_queue", "Queue"),
      {
        pushCurrentToStack: true,
        endPreviousReason: "replaced",
        currentItemId: queueItemId,
      },
    );
    void get().ensureQueueDepth();
    return activated;
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
        listeningTracker.end("error", get().positionMs);
        set({ playbackError: playbackFailureMessage(), isPlaying: false });
      }
    } else {
      try {
        await audioEngine.play();
      } catch {
        listeningTracker.end("error", get().positionMs);
        set({ playbackError: playbackFailureMessage(), isPlaying: false });
      }
    }
    void persistPlaybackState(get(), "checkpoint");
  },

  async seek(ms) {
    const value = Math.max(0, Math.min(get().durationMs, Math.round(ms)));
    try {
      await audioEngine.seekTo(value);
      if (get().currentTrackId) {
        set({ positionMs: value, playbackError: null });
      }
    } catch {
      listeningTracker.end("error", get().positionMs);
      set({ playbackError: playbackFailureMessage() });
    }
    void persistPlaybackState(get(), "checkpoint");
  },

  async previous() {
    playbackStateService.markLocalChange();
    const {
      positionMs,
      playedStack,
      playedItems,
      currentTrackId,
      currentItemId,
    } = get();
    if (currentTrackId) {
      listeningTracker.end("skipped_previous", positionMs);
    }
    if (positionMs > RESTART_THRESHOLD_MS || !playedStack.length) {
      set({ playbackContext: contextFor("direct", "Previous") });
      await get().seek(0);
      void persistPlaybackState(get(), "replace");
      return;
    }
    const previousItem = playedItems[playedItems.length - 1];
    const prevId = previousItem?.trackId || playedStack[playedStack.length - 1];
    const track = useLibraryStore.getState().getTrackById(prevId);
    if (!track || !isTrackPlayable(track)) return;
    set({
      playedStack: playedStack.slice(0, -1),
      playedItems: playedItems.slice(0, -1),
    });
    if (currentTrackId) {
      useQueueStore
        .getState()
        .enqueueNext(currentTrackId, get().playbackContext, {
          persist: false,
          refill: false,
          itemId: currentItemId,
        });
    }
    await activate(set, get, track, contextFor("direct", "Previous"), {
      pushCurrentToStack: false,
      endPreviousReason: null,
      currentItemId: previousItem?.id,
    });
  },

  async next(endedReason = "skipped_next") {
    playbackStateService.markLocalChange();
    if (get().currentTrackId) {
      listeningTracker.end(endedReason, get().positionMs);
    }
    let queuedContext = null;
    let queuedItemId = null;
    const takeQueuedTrack = () => takeNextPlayable({
      shift: () => {
        const entry = useQueueStore
          .getState()
          .shiftEntry({ persist: false, refill: false });
        queuedContext = entry?.context || null;
        queuedItemId = entry?.itemId || null;
        return entry?.id || null;
      },
      getTrack: (id) => useLibraryStore.getState().getTrackById(id),
      isPlayable: isTrackPlayable,
    });
    const track = await takeNextWithEmergency({
      takeNext: takeQueuedTrack,
      emergencyRefill: () => get().ensureQueueDepth({ emergency: true, force: true }),
    });
    if (track) {
      await activate(
        set,
        get,
        track,
        queuedContext || contextFor("manual_queue", "Queue"),
        {
          pushCurrentToStack: true,
          endPreviousReason: null,
          currentItemId: queuedItemId,
        },
      );
      void get().ensureQueueDepth();
      return;
    }
    try {
      await audioEngine.pause();
    } catch {
      set({ playbackError: playbackFailureMessage() });
    }
    set({ isPlaying: false, isBuffering: false, isLoading: false });
    void persistPlaybackState(get(), "replace");
  },

  async startSmartShuffle() {
    return startRecommendation(set, get, "smart");
  },

  async startRandomShuffle() {
    return startRecommendation(set, get, "random");
  },

  async playLikedSongs(likedTrackIds) {
    recommendationRequests.invalidate();
    getQueueRefillCoordinator().invalidate();
    const playable = likedTrackIds.filter((id) =>
      isTrackPlayable(useLibraryStore.getState().getTrackById(id)),
    );
    if (!playable.length) return;
    const [first, ...rest] = playable;
    const track = useLibraryStore.getState().getTrackById(first);
    const context = contextFor("liked_songs", "Liked Songs");
    useQueueStore
      .getState()
      .setFrom(rest.slice(0, DEFAULT_QUEUE_TARGET - 1), context, {
        persist: false,
        refill: false,
      });
    set({ shuffleMode: null });
    await activate(set, get, track, context, {
      pushCurrentToStack: true,
      endPreviousReason: "replaced",
    });
    void get().ensureQueueDepth();
  },

  async shuffleLikedSongs(likedTrackIds) {
    recommendationRequests.invalidate();
    getQueueRefillCoordinator().invalidate();
    const shuffled = likedTrackIds
      .filter((id) =>
        isTrackPlayable(useLibraryStore.getState().getTrackById(id)),
      )
      .sort(() => Math.random() - 0.5);
    if (!shuffled.length) return;
    const [first, ...rest] = shuffled;
    const track = useLibraryStore.getState().getTrackById(first);
    const context = contextFor("liked_songs", "Liked Songs · Shuffle");
    useQueueStore
      .getState()
      .setFrom(rest.slice(0, DEFAULT_QUEUE_TARGET - 1), context, {
        persist: false,
        refill: false,
      });
    set({ shuffleMode: null });
    await activate(set, get, track, context, {
      pushCurrentToStack: true,
      endPreviousReason: "replaced",
    });
    void get().ensureQueueDepth();
  },

  async retry() {
    const track = get().getCurrentTrack();
    if (!track || !isTrackPlayable(track)) return;
    await activate(set, get, track, get().playbackContext, {
      pushCurrentToStack: false,
      endPreviousReason: null,
    });
  },

  async persistNow() {
    listeningTracker.checkpointNow(true);
    await persistPlaybackState(get(), "replace");
    await playbackStateService.flush();
  },

  ensureQueueDepth(options) {
    return getQueueRefillCoordinator().refill(options);
  },
}));

async function activate(
  set,
  get,
  track,
  context,
  { pushCurrentToStack, endPreviousReason, currentItemId },
) {
  if (!isTrackPlayable(track)) return false;
  const operation = ++activationSequence;
  const prevId = get().currentTrackId;
  if (prevId && endPreviousReason) {
    listeningTracker.end(endPreviousReason, get().positionMs);
  }
  set((state) => ({
    currentTrackId: track.id,
    currentItemId: currentItemId || generateUuid(),
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
    playedItems:
      pushCurrentToStack && prevId && prevId !== track.id
        ? [
            ...state.playedItems,
            {
              id: state.currentItemId || generateUuid(),
              trackId: prevId,
              context: state.playbackContext,
            },
          ].slice(-PLAYED_STACK_LIMIT)
        : state.playedItems,
  }));
  void persistPlaybackState(get(), "replace");
  try {
    await audioEngine.load(track);
    if (operation !== activationSequence) return false;
    await audioEngine.play();
    if (operation !== activationSequence) return false;
    checkpointGate.reset(Date.now());
    return true;
  } catch {
    if (operation === activationSequence) {
      set({
        isPlaying: false,
        isBuffering: false,
        isLoading: false,
        playbackError: playbackFailureMessage(),
      });
      void persistPlaybackState(get(), "replace");
    }
    return false;
  }
}

async function persistPlaybackState(state, mode) {
  const snapshot = {
    current: state.currentTrackId
      ? {
          id: state.currentItemId || generateUuid(),
          trackId: state.currentTrackId,
          context: state.playbackContext,
        }
      : null,
    positionMs: state.currentTrackId ? state.positionMs : 0,
    shuffleMode: state.shuffleMode,
    upcoming: useQueueStore.getState().entries,
    played: state.playedItems,
    updatedAtMs: Date.now(),
  };
  void saveJSON(STORAGE_KEYS.currentTrack, {
    trackId: state.currentTrackId,
    positionMs: state.positionMs,
    context: state.playbackContext,
    shuffleMode: state.shuffleMode,
  });
  try {
    return mode === "checkpoint"
      ? await playbackStateService.checkpoint(snapshot)
      : await playbackStateService.replace(snapshot);
  } catch {
    return null;
  }
}

async function applyRestoredSnapshot(set, get, snapshot) {
  activationSequence += 1;
  const restored = await restorePlaybackSnapshot({
    snapshot,
    getTrack: (id) => useLibraryStore.getState().getTrackById(id),
    cacheTracks: (tracks) => useLibraryStore.getState().cacheTracks(tracks),
    hydrateQueue: (items) => useQueueStore.getState().hydrateSnapshot(items),
    setPlayer: set,
    getCurrentTrackId: () => get().currentTrackId,
    audioEngine,
    isPlayable: isTrackPlayable,
    normalizePosition: normalizeRestoredPosition,
    playbackFailureMessage,
  });
  void get().ensureQueueDepth();
  return restored;
}

async function startRecommendation(set, get, mode) {
  getQueueRefillCoordinator().invalidate();
  const token = recommendationRequests.begin(mode);
  if (!token) return false;
  set({ shufflePending: mode, shuffleError: null });
  const excludeTrackIds = [
    get().currentTrackId,
    ...get().playedStack.slice(-10),
    ...useQueueStore.getState().ids,
  ].filter(Boolean);
  try {
    const request =
      mode === "smart"
        ? recommendationService.getSmartShuffleQueue(30, { excludeTrackIds })
        : recommendationService.getRandomShuffleQueue(30);
    const batch = (await request)
      .filter(isTrackPlayable)
      .filter(
        (track, index, tracks) =>
          tracks.findIndex((candidate) => candidate.id === track.id) === index,
      )
      .slice(0, DEFAULT_QUEUE_TARGET);
    if (!recommendationRequests.isCurrent(token)) return false;
    if (!batch.length) {
      recommendationRequests.finish(token);
      set({
        shufflePending: null,
        shuffleError: "No playable tracks are available for this shuffle.",
      });
      return false;
    }
    useLibraryStore.getState().cacheTracks(batch);
    const prepared = prepareRecommendationPlayback(batch, mode);
    const { first, upcoming, context } = prepared;
    useQueueStore.getState().setFrom(
      upcoming.map((track) => track.id),
      context,
      { persist: false, refill: false },
    );
    set({ shuffleMode: mode, shufflePending: null, shuffleError: null });
    recommendationRequests.finish(token);
    await activate(set, get, first, context, {
      pushCurrentToStack: true,
      endPreviousReason: "replaced",
    });
    void get().ensureQueueDepth();
    return true;
  } catch {
    if (recommendationRequests.isCurrent(token)) {
      recommendationRequests.finish(token);
      set({
        shufflePending: null,
        shuffleError:
          "Unable to start a new shuffle. Try again when the server is available.",
      });
    }
    return false;
  }
}

function getQueueRefillCoordinator() {
  if (queueRefillCoordinator) return queueRefillCoordinator;
  queueRefillCoordinator = createQueueRefillCoordinator({
    getQueueEntries: () => useQueueStore.getState().entries,
    getCurrentTrackId: () => usePlayerStore.getState().currentTrackId,
    getRecentTrackIds: () => usePlayerStore.getState().playedStack,
    getMode: () => usePlayerStore.getState().shuffleMode,
    requestSmart: (count, options) =>
      recommendationService.getSmartShuffleQueue(count, options),
    requestRandom: (count, options) =>
      recommendationService.getRandomShuffleQueue(count, options),
    cacheTracks: (tracks) => useLibraryStore.getState().cacheTracks(tracks),
    appendTracks: (tracks, mode) => {
      const context =
        mode === "random"
          ? contextFor("random_shuffle", "Random Shuffle")
          : contextFor("smart_shuffle", "Smart Shuffle");
      useQueueStore
        .getState()
        .appendUnique(
          tracks.map((track) => track.id),
          context,
          { refill: false },
        );
    },
    isPlayable: isTrackPlayable,
  });
  return queueRefillCoordinator;
}

export default usePlayerStore;
