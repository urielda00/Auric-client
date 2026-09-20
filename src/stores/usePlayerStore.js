import { create } from "zustand";
import { audioEngine } from "../services/audio";
import {
  setQueueMutationHandler,
  setQueuePersistenceHandler,
  setQueueProjectionHandler,
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
} = require("../services/audio/playbackPolicy.cjs");
const {
  createListeningSessionTracker,
} = require("../services/listeningSessionTracker.cjs");
const {
  restorePlaybackSnapshot,
} = require("../services/audio/playbackRestore.cjs");
const {
  createLatestActivationCoordinator,
} = require("../services/audio/latestActivationCoordinator.cjs");
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
  buildContextSelection,
  createQueueRefillCoordinator,
  runExplicitNext,
} = require("../services/playbackQueuePolicy.cjs");
const {
  appendAdvancedHistory,
  buildPreviousQueue,
  consumeNativeTransition,
  createIdempotentTransitionTracker,
  createTransitionGate,
  selectPreviousAction,
} = require("../services/audio/nativeQueuePolicy.cjs");
const {
  notifyExplicitPlaybackSelection,
} = require("../features/player/playerNavigationIntent.cjs");

const CHECKPOINT_INTERVAL_MS = 15000;
const RESTART_THRESHOLD_MS = 4000;
const PLAYED_STACK_LIMIT = 50;
const NATIVE_PROJECTION_RETRY_DELAY_MS = 125;
const NATIVE_PROJECTION_ATTEMPTS = 2;

const checkpointGate = createCheckpointGate(CHECKPOINT_INTERVAL_MS);
const activations = createLatestActivationCoordinator();
const recommendationRequests = createRecommendationRequestCoordinator();
let queueRefillCoordinator = null;
let localHydration = null;
let backgroundReconciliation = null;
let nativeProjectionSync = null;
let nativeProjectionDirty = false;
const nextTransitionGate = createTransitionGate();
const nativeTransitions = createIdempotentTransitionTracker();

function contextFor(type, label) {
  return { type, label };
}

function invalidatePendingPlaybackWork(set) {
  recommendationRequests.invalidate();
  getQueueRefillCoordinator().invalidate();
  set({ shufflePending: null, shuffleError: null });
}

function playbackFailureMessage(error) {
  if (
    error?.code === "AUTHENTICATION_REQUIRED" ||
    error?.message === "AUTHENTICATION_REQUIRED"
  ) {
    return "Your device authorization expired. Pair Auric again to resume playback.";
  }
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

  async hydrate({ initializeAudio = true } = {}) {
    if (initializeAudio) audioEngine.initialize?.();
    setQueuePersistenceHandler(() => {
      void persistPlaybackState(get(), "replace");
    });
    setQueueMutationHandler(() => {
      void get().ensureQueueDepth();
    });
    setQueueProjectionHandler(() => {
      void syncNativeProjection(get);
    });
    playbackStateService.setConflictHandler((snapshot) =>
      applyRestoredSnapshot(set, get, snapshot, { loadAudio: false }),
    );
    audioEngine.setOnStatus((status) => {
      if (
        !isCurrentPlaybackEvent(
          status,
          get().currentTrackId,
          get().currentItemId,
        )
      )
        return;
      const activationPending = activations.isPendingGeneration(
        status.generation,
      );
      if (!activationPending) {
        listeningTracker.handleStatus(status, get().playbackContext);
      }
      const currentDuration = get().durationMs;
      const hadPlaybackError = Boolean(get().playbackError);
      set({
        positionMs: status.positionMs,
        durationMs: status.durationMs > 0 ? status.durationMs : currentDuration,
        isPlaying: status.isPlaying,
        isBuffering: status.isBuffering,
        isLoading: !status.isLoaded && !status.error,
        playbackError: status.error ? playbackFailureMessage(status.error) : null,
      });
      const now = Date.now();
      if (
        !activationPending &&
        checkpointGate.shouldCheckpoint({
          nowMs: now,
          isPlaying: status.isPlaying,
        })
      ) {
        void persistPlaybackState(get(), "checkpoint");
      }
      if (!activationPending && status.error && !hadPlaybackError) {
        void persistPlaybackState(get(), "checkpoint");
      }
    });
    audioEngine.setOnTrackChanged?.((event) =>
      get().handleNativeTrackChanged(event),
    );
    audioEngine.setOnRemoteNext?.(() => get().next("skipped_next"));
    audioEngine.setOnRemotePrevious?.(() =>
      get().previous({
        source: "remote",
        backgroundSessionReady: get().hydrated,
      }),
    );
    audioEngine.setOnEnded(
      createCompletionHandler({
        getCurrentTrackId: () => get().currentTrackId,
        next: () => get().recoverExhaustedNativeQueue(),
      }),
    );

    localHydration = await playbackStateService.hydrateLocal();
    if (localHydration.snapshot) {
      await applyRestoredSnapshot(set, get, localHydration.snapshot, {
        loadAudio: false,
        refillQueue: false,
      });
    }
    set({ hydrated: true, isPlaying: false });
  },

  async handleNativeTrackChanged(event) {
    const transitionKey = `${(event?.nativeItemIds || []).join(">")}:${
      event?.itemId || "none"
    }`;
    if (!event?.itemId || !nativeTransitions.accept(transitionKey)) return false;
    const queue = useQueueStore.getState();
    const transition = consumeNativeTransition({
      currentItemId: get().currentItemId,
      event,
      queueEntries: queue.entries,
    });
    if (!transition.accepted) {
      void syncNativeProjection(get);
      return false;
    }
    const first = transition.entry;
    const previous = get();
    const track = useLibraryStore.getState().getTrackById(event.trackId);
    if (!track || !isTrackPlayable(track)) return false;
    activations.invalidate();
    if (previous.currentTrackId) {
      listeningTracker.end(event.reason || "completed", previous.positionMs);
    }
    const history = appendAdvancedHistory({
      current: previous.currentTrackId
        ? {
            id: previous.currentItemId || generateUuid(),
            trackId: previous.currentTrackId,
            context: previous.playbackContext,
          }
        : null,
      advancedEntries: transition.advancedEntries,
      playedStack: previous.playedStack,
      playedItems: previous.playedItems,
      limit: PLAYED_STACK_LIMIT,
    });
    set((state) => ({
      currentTrackId: track.id,
      currentItemId: first.id,
      positionMs: 0,
      durationMs: track.durationMs || 0,
      isPlaying: audioEngine.getStatus().isPlaying,
      isBuffering: true,
      isLoading: true,
      playbackError: null,
      playbackContext:
        first.context || contextFor("manual_queue", "Queue"),
      playedStack: history.playedStack,
      playedItems: history.playedItems,
    }));
    queue.replaceEntries(transition.remaining, {
      persist: false,
      refill: false,
    });
    const durableHistory = persistPlaybackState(get(), "replace");
    void get().ensureQueueDepth();
    await Promise.allSettled([
      durableHistory,
      syncNativeProjection(get),
    ]);
    await syncNativeProjection(get);
    return true;
  },

  async recoverExhaustedNativeQueue() {
    if (!get().currentTrackId || nextTransitionGate.isPending()) return false;
    await get().ensureQueueDepth({ emergency: true, force: true });
    await syncNativeProjection(get);
    if (!useQueueStore.getState().entries.length) {
      set({ isPlaying: false, isBuffering: false, isLoading: false });
      return false;
    }
    return get().next("completed");
  },

  reconcileInBackground() {
    if (backgroundReconciliation) return backgroundReconciliation;
    const local = localHydration;
    const request = Promise.allSettled([
      listeningTracker.recoverPending(),
      playbackStateService
        .reconcile(local?.snapshot, local?.generation)
        .then((restored) => {
          if (
            restored.snapshot &&
            restored.source !== "local-stale-hydration" &&
            playbackStateService.isGenerationCurrent(local?.generation)
          ) {
            return applyRestoredSnapshot(set, get, restored.snapshot, {
              loadAudio: false,
            });
          }
          return false;
        }),
    ]);
    const shared = request.finally(() => {
      if (backgroundReconciliation === shared) {
        backgroundReconciliation = null;
      }
    });
    backgroundReconciliation = shared;
    return shared;
  },

  getCurrentTrack() {
    const { currentTrackId } = get();
    return currentTrackId
      ? useLibraryStore.getState().getTrackById(currentTrackId)
      : null;
  },

  async play(trackId, context) {
    const libraryTracks = useLibraryStore.getState().tracks;
    const tracks = libraryTracks.some((track) => track.id === trackId)
      ? libraryTracks
      : [trackId];
    return get().playTrackFromContext(trackId, tracks, context);
  },

  async playTrackFromContext(trackId, tracks, context, index) {
    const track = useLibraryStore.getState().getTrackById(trackId);
    if (!track || !isTrackPlayable(track)) return false;
    const selection = buildContextSelection(
      trackId,
      tracks,
      (id) => isTrackPlayable(useLibraryStore.getState().getTrackById(id)),
      index,
    );
    if (!selection) return false;
    const playbackContext = context || contextFor("direct", "Library");
    const upcomingEntries = createQueueEntries(
      selection.upcoming,
      playbackContext,
    );
    invalidatePendingPlaybackWork(set);
    playbackStateService.markLocalChange();
    const activated = await activate(set, get, track, playbackContext, {
      pushCurrentToStack: false,
      endPreviousReason: "replaced",
      upcomingEntries,
      replaceQueueOnStart: true,
      initialHistory: [],
      shuffleModeOnStart: null,
      openFullPlayer: true,
      activationDiagnosticReason: "context activation committed",
    });
    if (activated) {
      set({ shuffleMode: null, shufflePending: null, shuffleError: null });
      void persistPlaybackState(get(), "replace");
    }
    return activated;
  },

  async playQueued(trackId, context, queueItemId) {
    const track = useLibraryStore.getState().getTrackById(trackId);
    if (!track || !isTrackPlayable(track)) return false;
    playbackStateService.markLocalChange();
    const queue = useQueueStore.getState();
    const selectedIndex = queue.entries.findIndex(
      (item) => item.id === queueItemId,
    );
    if (selectedIndex < 0) return false;
    invalidatePendingPlaybackWork(set);
    const upcomingEntries = queue.entries.slice(selectedIndex + 1);
    const previousItems = [
      ...get().playedItems,
      ...(get().currentTrackId
        ? [
            {
              id: get().currentItemId || generateUuid(),
              trackId: get().currentTrackId,
              context: get().playbackContext,
            },
          ]
        : []),
    ].slice(-PLAYED_STACK_LIMIT);
    const activated = await activate(
      set,
      get,
      track,
      context || contextFor("manual_queue", "Queue"),
      {
        pushCurrentToStack: false,
        endPreviousReason: "replaced",
        currentItemId: queueItemId,
        upcomingEntries,
        replaceQueueOnStart: true,
        initialHistory: previousItems,
      },
    );
    if (activated) {
      await reconcileNativeProjection(get);
      logPlaybackDiagnostic("playQueued activation committed", get);
      void persistPlaybackState(get(), "replace");
      void get().ensureQueueDepth();
    }
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
        const status = audioEngine.getStatus();
        if (
          status.trackId !== get().currentTrackId ||
          status.isLoaded !== true
        ) {
          const track = get().getCurrentTrack();
          if (!track || !isTrackPlayable(track)) return;
          const restoredPosition = get().positionMs;
          const expectedTrackId = track.id;
          set({ isLoading: true, isBuffering: true, playbackError: null });
          await audioEngine.load(track, {
            currentItemId: get().currentItemId,
            context: get().playbackContext,
            upcoming: nativeEntries(useQueueStore.getState().entries),
          });
          if (get().currentTrackId !== expectedTrackId) return;
          await audioEngine.seekTo(restoredPosition);
        }
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

  async previous({ source = "foreground", backgroundSessionReady = false } = {}) {
    invalidatePendingPlaybackWork(set);
    playbackStateService.markLocalChange();
    const {
      playedStack,
      playedItems,
      currentTrackId,
      currentItemId,
    } = get();
    const nativeStatus = audioEngine.getStatus();
    const positionMs =
      nativeStatus.trackId === currentTrackId &&
      nativeStatus.itemId === currentItemId &&
      Number.isFinite(nativeStatus.positionMs)
        ? nativeStatus.positionMs
        : get().positionMs;
    const previousAction = selectPreviousAction({
      positionMs,
      hasHistory: playedStack.length > 0,
      restartThresholdMs: RESTART_THRESHOLD_MS,
    });
    if (source === "remote") {
      logRemotePreviousDiagnostic({
        backgroundSessionReady,
        currentTrackId,
        currentItemId,
        liveNativePositionMs: positionMs,
        playedItems,
        playedStack,
        previousAction,
      });
    }
    if (previousAction === "restart-current") {
      await get().seek(0);
      await persistPlaybackState(get(), "replace");
      return true;
    }
    const previousItem = playedItems[playedItems.length - 1];
    const prevId = previousItem?.trackId || playedStack[playedStack.length - 1];
    const track = useLibraryStore.getState().getTrackById(prevId);
    if (!track || !isTrackPlayable(track)) {
      await get().seek(0);
      await persistPlaybackState(get(), "replace");
      return true;
    }
    const queue = useQueueStore.getState();
    const remainingHistory = playedItems.slice(0, -1);
    const upcomingEntries = buildPreviousQueue(
      currentTrackId
        ? {
            id: currentItemId || generateUuid(),
            trackId: currentTrackId,
            context: get().playbackContext,
          }
        : null,
      queue.entries,
    );
    const activated = await activate(
      set,
      get,
      track,
      previousItem?.context || contextFor("direct", "Previous"),
      {
        pushCurrentToStack: false,
        endPreviousReason: "skipped_previous",
        currentItemId: previousItem?.id,
        upcomingEntries,
        replaceQueueOnStart: true,
        initialHistory: remainingHistory,
      },
    );
    if (!activated) return;
    await persistPlaybackState(get(), "replace");
    return true;
  },

  async next(endedReason = "skipped_next", expectedItemId = null) {
    if (activations.deferNext()) return true;
    const targetItemId = expectedItemId || get().currentItemId;
    return nextTransitionGate.run(async () => {
      const isCurrent = () =>
        get().currentItemId === targetItemId &&
        !activations.hasUncommittedSelection();
      if (!isCurrent()) return false;
      playbackStateService.markLocalChange();
      try {
        return await runExplicitNext({
          isCurrent,
          hasLogicalSuccessor: hasPlayableLogicalSuccessor,
          reconcile: () => reconcileNativeProjection(get),
          advance: () => audioEngine.next(endedReason),
          emergencyRefill: () =>
            get().ensureQueueDepth({ emergency: true, force: true }),
          pauseAtExhaustion: async () => {
            await audioEngine.pause();
            set({ isPlaying: false, isBuffering: false, isLoading: false });
            void persistPlaybackState(get(), "replace");
          },
        });
      } catch (error) {
        if (error?.message === "STALE_ACTIVATION") return false;
        set({
          playbackError: playbackFailureMessage(error),
          isBuffering: false,
          isLoading: false,
        });
        return false;
      }
    });
  },

  async startSmartShuffle() {
    return startRecommendation(set, get, "smart");
  },

  async startRandomShuffle() {
    return startRecommendation(set, get, "random");
  },

  async playLikedSongs(likedTrackIds) {
    const playable = likedTrackIds.filter((id) =>
      isTrackPlayable(useLibraryStore.getState().getTrackById(id)),
    );
    if (!playable.length) return false;
    return get().playTrackFromContext(
      playable[0],
      playable,
      contextFor("liked_songs", "Liked Songs"),
    );
  },

  async shuffleLikedSongs(likedTrackIds) {
    const shuffled = likedTrackIds
      .filter((id) =>
        isTrackPlayable(useLibraryStore.getState().getTrackById(id)),
      )
      .sort(() => Math.random() - 0.5);
    if (!shuffled.length) return false;
    return get().playTrackFromContext(
      shuffled[0],
      shuffled,
      contextFor("liked_songs", "Liked Songs · Shuffle"),
    );
  },

  async retry() {
    const track = get().getCurrentTrack();
    if (!track || !isTrackPlayable(track)) return;
    const retryingUncommittedSelection =
      activations.hasUncommittedSelection();
    const activated = await activate(set, get, track, get().playbackContext, {
      pushCurrentToStack: retryingUncommittedSelection,
      endPreviousReason: retryingUncommittedSelection ? "replaced" : null,
      currentItemId: get().currentItemId,
    });
    if (activated) void persistPlaybackState(get(), "replace");
  },

  async persistNow() {
    listeningTracker.checkpointNow(true);
    await getQueueRefillCoordinator().waitForPending();
    await syncNativeProjection(get);
    await persistPlaybackState(get(), "replace");
    await playbackStateService.flush();
  },

  ensureQueueDepth(options) {
    if (activations.hasUncommittedSelection()) return Promise.resolve(false);
    if (get().shuffleMode !== "smart" && get().shuffleMode !== "random") {
      return Promise.resolve(false);
    }
    return getQueueRefillCoordinator().refill(options);
  },
}));

async function activate(
  set,
  get,
  track,
  context,
  {
    pushCurrentToStack,
    endPreviousReason,
    currentItemId,
    upcomingEntries = useQueueStore.getState().entries,
    replaceQueueOnStart = false,
    initialHistory = null,
    shuffleModeOnStart,
    openFullPlayer = false,
    activationDiagnosticReason = null,
  },
) {
  if (!isTrackPlayable(track)) return false;
  const { token, baseline: previous } = activations.begin(() => ({
    ...get(),
    queueEntries: useQueueStore.getState().entries,
  }));
  const nextItemId = currentItemId || generateUuid();
  const nativeUpcoming = nativeEntries(upcomingEntries);
  const previousQueueEntries = replaceQueueOnStart
    ? previous.queueEntries
    : null;
  set({
    currentTrackId: track.id,
    currentItemId: nextItemId,
    positionMs: 0,
    durationMs: track.durationMs || 0,
    isPlaying: false,
    isBuffering: true,
    isLoading: true,
    playbackError: null,
    playbackContext: context,
    ...(shuffleModeOnStart !== undefined
      ? { shuffleMode: shuffleModeOnStart }
      : {}),
    ...(initialHistory
      ? {
          playedItems: initialHistory,
          playedStack: initialHistory.map((item) => item.trackId),
        }
      : {}),
  });
  if (replaceQueueOnStart) {
    useQueueStore.getState().replaceEntries(upcomingEntries, {
      persist: false,
      refill: false,
    });
  }
  if (openFullPlayer) notifyExplicitPlaybackSelection(true);
  try {
    const reservedGeneration = audioEngine.beginActivation();
    if (!activations.attachGeneration(token, reservedGeneration)) return false;
    const generation = await audioEngine.load(track, {
      currentItemId: nextItemId,
      context,
      upcoming: nativeUpcoming,
      activationGeneration: reservedGeneration,
    });
    const isNativeCurrent = (value) =>
      audioEngine.isGenerationCurrent(value);
    if (!activations.isCurrent(token, isNativeCurrent)) return false;
    if (replaceQueueOnStart) {
      await playbackStateService.stageLocal(playbackSnapshot(get()));
      if (!activations.isCurrent(token, isNativeCurrent)) return false;
    }
    await audioEngine.play(generation);
    await audioEngine.waitUntilReady?.(generation);
    if (!activations.isCurrent(token, isNativeCurrent)) return false;
    // Android can accept Play while preparing without starting once Ready.
    // Reassert the same generation after readiness so a track tap always starts.
    await audioEngine.play(generation);
    if (!activations.isCurrent(token, isNativeCurrent)) return false;
    if (previous.currentTrackId && endPreviousReason) {
      listeningTracker.end(endPreviousReason, previous.positionMs);
    }
    nativeTransitions.reset();
    const nativeStatus = audioEngine.getStatus();
    set(() => ({
      currentTrackId: track.id,
      currentItemId: nextItemId,
      positionMs: 0,
      durationMs: track.durationMs || 0,
      isPlaying: nativeStatus.isPlaying,
      isBuffering: nativeStatus.isBuffering,
      isLoading: nativeStatus.isLoaded !== true,
      playbackError: null,
      playbackContext: context,
      playedStack: initialHistory
        ? initialHistory.map((item) => item.trackId)
        : pushCurrentToStack &&
        previous.currentTrackId &&
        previous.currentTrackId !== track.id
          ? [...previous.playedStack, previous.currentTrackId].slice(
              -PLAYED_STACK_LIMIT,
            )
          : previous.playedStack,
      playedItems: initialHistory
        ? initialHistory
        : pushCurrentToStack &&
        previous.currentTrackId &&
        previous.currentTrackId !== track.id
          ? [
              ...previous.playedItems,
              {
                id: previous.currentItemId || generateUuid(),
                trackId: previous.currentTrackId,
                context: previous.playbackContext,
              },
            ].slice(-PLAYED_STACK_LIMIT)
          : previous.playedItems,
    }));
    const committed = activations.commitAndTakeProjectionRequest(
      token,
      isNativeCurrent,
    );
    if (!committed.committed) return false;
    if (activationDiagnosticReason) {
      logPlaybackDiagnostic(activationDiagnosticReason, get);
    }
    await syncNativeProjection(get);
    listeningTracker.handleStatus(nativeStatus, context);
    checkpointGate.reset(Date.now());
    if (committed.nextRequested && get().currentItemId === nextItemId) {
      await get().next("skipped_next", nextItemId);
    }
    return true;
  } catch (error) {
    const isNativeCurrent = (value) =>
      audioEngine.isGenerationCurrent(value);
    if (activations.fail(token, isNativeCurrent)) {
      if (replaceQueueOnStart && get().currentItemId === nextItemId) {
        useQueueStore.getState().replaceEntries(previousQueueEntries, {
          persist: false,
          refill: false,
        });
        void playbackStateService.stageLocal(playbackSnapshot(previous));
      }
      set({
        currentTrackId: track.id,
        currentItemId: nextItemId,
        positionMs: 0,
        durationMs: track.durationMs || 0,
        playbackContext: context,
        ...(initialHistory
          ? {
              playedItems: previous.playedItems,
              playedStack: previous.playedStack,
            }
          : {}),
        ...(shuffleModeOnStart !== undefined
          ? { shuffleMode: previous.shuffleMode }
          : {}),
        isPlaying: false,
        isBuffering: false,
        isLoading: false,
        playbackError: playbackFailureMessage(error),
      });
    }
    return false;
  }
}

function createQueueEntries(trackIds, context) {
  return trackIds.map((trackId) => ({
    id: generateUuid(),
    trackId,
    context,
  }));
}

function nativeEntries(entries) {
  return entries
    .map((item) => ({
      ...item,
      itemId: item.id,
      track: useLibraryStore.getState().getTrackById(item.trackId),
    }))
    .filter((item) => isTrackPlayable(item.track));
}

function hasPlayableLogicalSuccessor() {
  return nativeEntries(useQueueStore.getState().entries).length > 0;
}

function expectedNativeMediaIds(get) {
  const currentItemId = get().currentItemId;
  if (!currentItemId) return [];
  return [
    currentItemId,
    ...nativeEntries(useQueueStore.getState().entries)
      .map((item) => item.itemId),
  ];
}

function nativeProjectionAccepted(get) {
  const expectedIds = expectedNativeMediaIds(get);
  const native = audioEngine.getNativePlaybackSnapshot?.();
  if (!native || !expectedIds.length) return false;
  return (
    native.nativeActiveMediaId === expectedIds[0] &&
    native.nativeActiveIndex === 0 &&
    native.nativeQueueMediaIds.length === expectedIds.length &&
    native.nativeQueueMediaIds.every((id, index) => id === expectedIds[index])
  );
}

async function reconcileNativeProjection(
  get,
  {
    attempts = NATIVE_PROJECTION_ATTEMPTS,
    retryDelayMs = NATIVE_PROJECTION_RETRY_DELAY_MS,
  } = {},
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await syncNativeProjection(get);
    if (nativeProjectionAccepted(get)) return true;
    if (attempt + 1 < attempts) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  return false;
}

function isDevelopmentBuild() {
  return typeof __DEV__ !== "undefined" && __DEV__;
}

function logPlaybackDiagnostic(reason, get, { level = "debug" } = {}) {
  if (!isDevelopmentBuild()) return null;
  const state = get();
  const native = audioEngine.getNativePlaybackSnapshot?.() || {
    nativeActiveMediaId: null,
    nativeActiveIndex: null,
    nativeQueueMediaIds: [],
    nativeIsPlaying: false,
  };
  const snapshot = {
    reason,
    logicalCurrentItemId: state.currentItemId,
    logicalUpcomingItemIds: useQueueStore
      .getState()
      .entries.map((item) => item.id),
    ...native,
  };
  const logger = level === "error" ? console.error : console.debug;
  logger("[AuricPlayback]", snapshot);
  return snapshot;
}

function logRemotePreviousDiagnostic({
  backgroundSessionReady,
  currentTrackId,
  currentItemId,
  liveNativePositionMs,
  playedItems,
  playedStack,
  previousAction,
}) {
  if (!isDevelopmentBuild()) return;
  const previousItem = playedItems[playedItems.length - 1];
  console.debug("[AuricRemotePrevious]", {
    remotePreviousReceived: true,
    backgroundSessionReady: backgroundSessionReady === true,
    currentTrackId,
    currentItemId,
    liveNativePositionMs,
    playedItemsCount: playedItems.length,
    previousTrackId:
      previousItem?.trackId || playedStack[playedStack.length - 1] || null,
    chosenAction: previousAction,
  });
}

async function syncNativeProjection(get) {
  if (!activations.requestProjection()) return false;
  nativeProjectionDirty = true;
  if (nativeProjectionSync) return nativeProjectionSync;

  const request = (async () => {
    let changed = false;
    while (nativeProjectionDirty) {
      nativeProjectionDirty = false;
      const state = get();
      if (!state.currentTrackId || !state.currentItemId) continue;
      const track = state.getCurrentTrack();
      if (!track || !isTrackPlayable(track)) continue;
      const itemId = state.currentItemId;
      const entryIds = useQueueStore
        .getState()
        .entries.map((item) => item.id)
        .join(">");
      try {
        changed =
          (await audioEngine.syncQueue(
            {
              track,
              itemId,
              context: state.playbackContext,
            },
            nativeEntries(useQueueStore.getState().entries),
          )) || changed;
      } catch {
        // A later queue/native event requests another bounded reconciliation.
      }
      const latest = get();
      const latestEntryIds = useQueueStore
        .getState()
        .entries.map((item) => item.id)
        .join(">");
      if (latest.currentItemId !== itemId || latestEntryIds !== entryIds) {
        nativeProjectionDirty = true;
      }
    }
    return changed;
  })();
  nativeProjectionSync = request.finally(() => {
    if (nativeProjectionSync === request || nativeProjectionSync === wrapped) {
      nativeProjectionSync = null;
    }
  });
  const wrapped = nativeProjectionSync;
  return wrapped;
}

function playbackSnapshot(state) {
  return {
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
}

async function persistPlaybackState(state, mode) {
  if (activations.hasUncommittedSelection()) return null;
  const snapshot = playbackSnapshot(state);
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

async function applyRestoredSnapshot(
  set,
  get,
  snapshot,
  { loadAudio = false, refillQueue = true } = {},
) {
  activations.invalidate();
  audioEngine.cancelActivation?.();
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
    loadAudio,
  });
  if (refillQueue) void get().ensureQueueDepth();
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
    const upcomingEntries = createQueueEntries(
      upcoming.map((track) => track.id),
      context,
    );
    const activated = await activate(set, get, first, context, {
      pushCurrentToStack: false,
      endPreviousReason: "replaced",
      upcomingEntries,
      replaceQueueOnStart: true,
      initialHistory: [],
      shuffleModeOnStart: mode,
    });
    if (!activated || !recommendationRequests.isCurrent(token)) return false;
    set({ shuffleMode: mode, shufflePending: null, shuffleError: null });
    recommendationRequests.finish(token);
    void get().ensureQueueDepth();
    void persistPlaybackState(get(), "replace");
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
