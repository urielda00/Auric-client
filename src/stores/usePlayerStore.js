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
  createActivationRetryCoordinator,
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
const retryPlans = createActivationRetryCoordinator();
const recommendationRequests = createRecommendationRequestCoordinator();
let queueRefillCoordinator = null;
let localHydration = null;
let backgroundReconciliation = null;
let nativeProjectionSync = null;
let nativeProjectionDirty = false;
let queueSessionId = null;
let coldRestoreDepth = 0;
const nextTransitionGate = createTransitionGate();
const nativeTransitions = createIdempotentTransitionTracker();

function tracePlaybackMutation(source, get, before, {
  intendedTrackId = null,
  activationGeneration = null,
  force = false,
  details = null,
} = {}) {
  if (!isDevelopmentBuild()) return;
  const after = get();
  if (!force &&
    before.currentTrackId === after.currentTrackId &&
    before.currentItemId === after.currentItemId &&
    before.isPlaying === after.isPlaying &&
    before.isBuffering === after.isBuffering &&
    before.isLoading === after.isLoading) return;
  const native = audioEngine.getNativePlaybackSnapshot?.();
  console.debug("[AuricPlayback] state mutation", {
    source,
    timestamp: Date.now(),
    activationGeneration: activationGeneration ?? audioEngine.getStatus().generation,
    selectionGeneration: playbackStateService.selectionGeneration,
    queueSessionId,
    intendedTrackId,
    beforeTrackId: before.currentTrackId,
    afterTrackId: after.currentTrackId,
    beforeItemId: before.currentItemId,
    afterItemId: after.currentItemId,
    beforeIsPlaying: before.isPlaying,
    afterIsPlaying: after.isPlaying,
    nativeActiveMediaId: native?.nativeActiveMediaId ?? null,
    nativeIsPlaying: native?.nativeIsPlaying ?? false,
    details,
  });
}

function setPlayback(set, get, patch, source, options) {
  const before = get();
  set(patch);
  tracePlaybackMutation(source, get, before, options);
}

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
  onError: (error, diagnostic) => {
    if (!isDevelopmentBuild()) return;
    console.error("[AuricListeningSession] request failed", {
      ...diagnostic,
      code: error?.code,
      status: error?.status,
      message: error?.message,
      validation: error?.details,
      requestId: error?.requestId,
    });
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
    audioEngine.setOnStatus((status) => {
      if (coldRestoreDepth > 0) return;
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
      setPlayback(set, get, {
        positionMs: status.positionMs,
        durationMs: status.durationMs > 0 ? status.durationMs : currentDuration,
        isPlaying: status.isPlaying,
        isBuffering: status.isBuffering,
        isLoading: !status.isLoaded && !status.error,
        playbackError: status.error ? playbackFailureMessage(status.error) : null,
      }, "native status", { intendedTrackId: status.trackId, activationGeneration: status.generation });
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
    const handleCompletion = createCompletionHandler({
      getCurrentTrackId: () => get().currentTrackId,
      next: () => get().recoverExhaustedNativeQueue(),
    });
    audioEngine.setOnEnded((event) => {
      if (coldRestoreDepth > 0 || audioEngine.isSilentRestore?.()) {
        tracePlaybackMutation("native completion suppressed during restore", get, get(), {
          intendedTrackId: event?.trackId, force: true,
          details: { eventItemId: event?.itemId },
        });
        return false;
      }
      return handleCompletion(event);
    });

    localHydration = await playbackStateService.hydrateLocal();
    if (localHydration.snapshot &&
      playbackStateService.isGenerationCurrent(localHydration.generation) &&
      !activations.hasUncommittedSelection()) {
      await applyRestoredSnapshot(set, get, localHydration.snapshot, {
        loadAudio: initializeAudio,
        refillQueue: false,
        source: "local hydration",
      });
    } else if (localHydration.snapshot) {
      tracePlaybackMutation("stale local hydration skipped", get, get(), {
        intendedTrackId: localHydration.snapshot.current?.trackId, force: true,
      });
    }
    set({ hydrated: true });
  },

  async handleNativeTrackChanged(event) {
    if (coldRestoreDepth > 0 || audioEngine.isSilentRestore?.()) {
      tracePlaybackMutation("native transition suppressed during restore", get, get(), {
        intendedTrackId: event?.trackId, force: true,
        details: { eventItemId: event?.itemId },
      });
      return false;
    }
    const native = audioEngine.getNativePlaybackSnapshot?.();
    if ((event?.generation != null && !audioEngine.isGenerationCurrent(event.generation)) ||
      (native?.nativeActiveMediaId && native.nativeActiveMediaId !== event?.itemId)) {
      tracePlaybackMutation("stale native transition skipped", get, get(), {
        intendedTrackId: event?.trackId, activationGeneration: event?.generation,
        force: true, details: { eventItemId: event?.itemId },
      });
      return false;
    }
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
      tracePlaybackMutation("native transition rejected", get, get(), {
        intendedTrackId: event.trackId, activationGeneration: event.generation,
        force: true, details: { eventItemId: event.itemId },
      });
      void syncNativeProjection(get);
      return false;
    }
    const first = transition.entry;
    const previous = get();
    const track = useLibraryStore.getState().getTrackById(event.trackId);
    if (!track || !isTrackPlayable(track)) return false;
    activations.invalidate();
    playbackStateService.markLocalChange();
    if (previous.currentTrackId) {
      tracePlaybackMutation("listening session end on native transition", get, previous, {
        intendedTrackId: previous.currentTrackId, force: true,
        details: { reason: event.reason || "completed" },
      });
      listeningTracker.end(event.reason || "completed", previous.positionMs, {
        trackId: previous.currentTrackId,
        playbackItemId: previous.currentItemId,
      });
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
    setPlayback(set, get, (state) => ({
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
    }), "native track transition", { intendedTrackId: track.id, activationGeneration: event.generation });
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
    const ownerItemId = get().currentItemId;
    const ownerSelectionGeneration = playbackStateService.selectionGeneration;
    const isCurrent = () => get().currentItemId === ownerItemId &&
      playbackStateService.selectionGeneration === ownerSelectionGeneration &&
      !activations.hasUncommittedSelection();
    await get().ensureQueueDepth({ emergency: true, force: true });
    if (!isCurrent()) {
      tracePlaybackMutation("stale native completion skipped", get, get(), {
        force: true, details: { ownerItemId, ownerSelectionGeneration },
      });
      return false;
    }
    await syncNativeProjection(get);
    if (!isCurrent()) return false;
    if (!useQueueStore.getState().entries.length) {
      setPlayback(set, get, { isPlaying: false, isBuffering: false, isLoading: false }, "native queue exhausted");
      return false;
    }
    return get().next("completed", ownerItemId);
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
              loadAudio: true,
              source: "background reconciliation",
            });
          }
          if (restored.snapshot) tracePlaybackMutation("stale background reconciliation skipped", get, get(), {
            intendedTrackId: restored.snapshot.current?.trackId, force: true,
            details: { source: restored.source },
          });
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
    if (!track || !isTrackPlayable(track)) {
      if (isDevelopmentBuild()) console.debug("[AuricPlayback] tap rejected", { trackId, reason: "unplayable" });
      return false;
    }
    const selection = buildContextSelection(
      trackId,
      tracks,
      (id) => isTrackPlayable(useLibraryStore.getState().getTrackById(id)),
      index,
    );
    if (!selection) {
      if (isDevelopmentBuild()) console.debug("[AuricPlayback] tap rejected", { trackId, index, reason: "missing from context" });
      return false;
    }
    if (isDevelopmentBuild()) console.debug("[AuricPlayback] context entry", { trackId, index, sourceSize: tracks?.length, upcomingSize: selection.upcoming.length, context: context?.type });
    tracePlaybackMutation("context track tap", get, get(), { intendedTrackId: trackId, force: true,
      details: { context: context?.type, selectedIndex: index ?? null } });
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
      newQueueSession: true,
      openFullPlayer: true,
      activationDiagnosticReason: "context activation committed",
    });
    if (activated) {
      const activatedItemId = get().currentItemId;
      set({ shuffleMode: null, shufflePending: null, shuffleError: null });
      // Recommendations also exclude the server's active queue. Publish this
      // context first so an old session cannot exhaust the candidate pool.
      await persistPlaybackState(get(), "replace");
      if (get().currentItemId === activatedItemId &&
        !activations.hasUncommittedSelection()) {
        await get().ensureQueueDepth({ force: true });
      }
    }
    return activated;
  },

  async playQueued(trackId, context, queueItemId) {
    const track = useLibraryStore.getState().getTrackById(trackId);
    if (!track || !isTrackPlayable(track)) {
      if (isDevelopmentBuild()) console.debug("[AuricPlayback] queue activation failed", { trackId, queueItemId, reason: "unplayable" });
      return false;
    }
    const queue = useQueueStore.getState();
    const selectedIndex = queue.entries.findIndex(
      (item) => item.id === queueItemId,
    );
    if (selectedIndex < 0) {
      if (isDevelopmentBuild()) console.debug("[AuricPlayback] queue activation failed", { trackId, queueItemId, reason: "item missing" });
      return false;
    }
    playbackStateService.markLocalChange();
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
    if (isDevelopmentBuild()) console.debug("[AuricPlayback] queue activation start", { trackId, queueItemId, selectedIndex, remainingSize: upcomingEntries.length, previousSize: previousItems.length });
    tracePlaybackMutation("queue item tap", get, get(), { intendedTrackId: trackId, force: true,
      details: { queueItemId, selectedIndex } });
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
        activationDiagnosticReason: "playQueued activation committed",
      },
    );
    if (activated) {
      // activate already synchronized the native queue and confirmed playback.
      // A second reconciliation here can race that play.
      const persisted = await persistPlaybackState(get(), "replace");
      if (isDevelopmentBuild()) console.debug("[AuricPlayback] queue persistence settled", { queueItemId, accepted: Boolean(persisted), currentItemId: get().currentItemId, revision: playbackStateService.revision });
      let status = audioEngine.getStatus();
      if (get().currentItemId !== queueItemId || status.itemId !== queueItemId) {
        if (isDevelopmentBuild()) console.error("[AuricPlayback] queue activation failed", { trackId, queueItemId, reason: "selection changed", status });
        return false;
      }
      if (status.isPlaying !== true) {
        if (isDevelopmentBuild()) console.debug("[AuricPlayback] queue play reasserted", { trackId, queueItemId });
        try {
          await audioEngine.play(status.generation);
          await audioEngine.waitUntilPlaying?.(status.generation);
          status = audioEngine.getStatus();
        } catch (error) {
          if (get().currentItemId === queueItemId) setPlayback(set, get,
            { isPlaying: false, playbackError: playbackFailureMessage(error) },
            "queue play reassert failed", { intendedTrackId: trackId });
          if (isDevelopmentBuild()) console.error("[AuricPlayback] queue activation failed", { trackId, queueItemId, code: error?.code || error?.message });
          return false;
        }
      }
      if (get().currentItemId !== queueItemId || status.itemId !== queueItemId || status.isPlaying !== true) {
        if (get().currentItemId === queueItemId) setPlayback(set, get,
          { isPlaying: false, playbackError: playbackFailureMessage() },
          "queue native confirmation failed", { intendedTrackId: trackId });
        if (isDevelopmentBuild()) console.error("[AuricPlayback] queue activation failed", { trackId, queueItemId, reason: "native playback not confirmed", status });
        return false;
      }
      if (!get().isPlaying) setPlayback(set, get,
        { isPlaying: true, playbackError: null }, "queue play confirmed", { intendedTrackId: trackId });
      void get().ensureQueueDepth();
    } else if (isDevelopmentBuild()) {
      console.error("[AuricPlayback] queue activation failed", { trackId, queueItemId, reason: "activate returned false" });
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
        const beforePause = get();
        await audioEngine.pause();
        tracePlaybackMutation("user pause requested", get, beforePause, { intendedTrackId: beforePause.currentTrackId, force: true });
      } catch {
        const current = get();
        listeningTracker.end("error", current.positionMs, {
          trackId: current.currentTrackId,
          playbackItemId: current.currentItemId,
        });
        setPlayback(set, get, { playbackError: playbackFailureMessage(), isPlaying: false },
          "user pause failed");
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
          setPlayback(set, get, { isLoading: true, isBuffering: true, playbackError: null },
            "toggle reload", { intendedTrackId: track.id });
          await audioEngine.load(track, {
            currentItemId: get().currentItemId,
            context: get().playbackContext,
            upcoming: nativeEntries(useQueueStore.getState().entries),
          });
          if (get().currentTrackId !== expectedTrackId) return;
          await audioEngine.seekTo(restoredPosition);
        }
        const beforePlay = get();
        await audioEngine.play();
        tracePlaybackMutation("user play requested", get, beforePlay, { intendedTrackId: beforePlay.currentTrackId, force: true });
      } catch {
        const current = get();
        listeningTracker.end("error", current.positionMs, {
          trackId: current.currentTrackId,
          playbackItemId: current.currentItemId,
        });
        setPlayback(set, get, { playbackError: playbackFailureMessage(), isPlaying: false },
          "user play failed");
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
      const current = get();
      listeningTracker.end("error", current.positionMs, {
        trackId: current.currentTrackId,
        playbackItemId: current.currentItemId,
      });
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
      void get().ensureQueueDepth();
      return true;
    }
    const previousItem = playedItems[playedItems.length - 1];
    const prevId = previousItem?.trackId || playedStack[playedStack.length - 1];
    const track = useLibraryStore.getState().getTrackById(prevId);
    if (!track || !isTrackPlayable(track)) {
      await get().seek(0);
      await persistPlaybackState(get(), "replace");
      void get().ensureQueueDepth();
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
    void get().ensureQueueDepth();
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
            const beforePause = get();
            await audioEngine.pause();
            tracePlaybackMutation("Next exhausted native pause", get, beforePause, { force: true });
            setPlayback(set, get, { isPlaying: false, isBuffering: false, isLoading: false },
              "Next exhausted");
            void persistPlaybackState(get(), "replace");
          },
        });
      } catch (error) {
        if (error?.message === "STALE_ACTIVATION") return false;
        setPlayback(set, get, {
          playbackError: playbackFailureMessage(error),
          isBuffering: false,
          isLoading: false,
        }, "Next failed");
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
    const plan = retryPlans.match(track.id, get().currentItemId);
    const retryingUncommittedSelection =
      activations.hasUncommittedSelection();
    const activated = await activate(set, get, track, plan?.context || get().playbackContext, {
      pushCurrentToStack: plan ? false : retryingUncommittedSelection,
      endPreviousReason: plan?.endPreviousReason ||
        (retryingUncommittedSelection ? "replaced" : null),
      currentItemId: get().currentItemId,
      ...(plan || {}),
      preserveRetryPlan: true,
    });
    if (activated) {
      void persistPlaybackState(get(), "replace");
      void get().ensureQueueDepth();
    }
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
    newQueueSession = false,
    preserveRetryPlan = false,
    openFullPlayer = false,
    activationDiagnosticReason = null,
  },
) {
  if (!isTrackPlayable(track)) return false;
  if (!preserveRetryPlan) retryPlans.clear();
  const { token, baseline: previous } = activations.begin(() => ({
    ...get(),
    queueEntries: useQueueStore.getState().entries,
  }));
  const nextItemId = currentItemId || generateUuid();
  const nativeUpcoming = nativeEntries(upcomingEntries);
  if (isDevelopmentBuild()) console.debug("[AuricPlayback] activation start", { trackId: track.id, itemId: nextItemId, activationSequence: token.sequence, logicalUpcomingBeforeNativeLoad: upcomingEntries.length, nativeSuccessors: nativeUpcoming.length });
  try {
    const beforeNativeActivation = get();
    const reservedGeneration = audioEngine.beginActivation();
    tracePlaybackMutation("native activation reserved", get, beforeNativeActivation, {
      intendedTrackId: track.id, activationGeneration: reservedGeneration, force: true,
      details: { activationSequence: token.sequence, queueSessionId },
    });
    if (!activations.attachGeneration(token, reservedGeneration)) return false;
    if (isDevelopmentBuild()) console.debug("[AuricPlayback] activation generation", { trackId: track.id, itemId: nextItemId, activationSequence: token.sequence, nativeGeneration: reservedGeneration });
    const generation = await audioEngine.load(track, {
      currentItemId: nextItemId,
      context,
      upcoming: nativeUpcoming,
      activationGeneration: reservedGeneration,
    });
    tracePlaybackMutation("native queue loaded", get, beforeNativeActivation, {
      intendedTrackId: track.id, activationGeneration: generation, force: true,
      details: { activationSequence: token.sequence },
    });
    const isNativeCurrent = (value) =>
      audioEngine.isGenerationCurrent(value);
    if (!activations.isCurrent(token, isNativeCurrent)) return false;
    const loadedNative = audioEngine.getNativePlaybackSnapshot?.();
    if (isDevelopmentBuild()) console.debug("[AuricPlayback] native queue after load", { trackId: track.id, itemId: nextItemId, mediaIds: loadedNative?.nativeQueueMediaIds, count: loadedNative?.nativeQueueMediaIds?.length, activeId: loadedNative?.nativeActiveMediaId });
    if (loadedNative?.nativeActiveMediaId !== nextItemId) throw new Error("NATIVE_ACTIVE_ITEM_MISMATCH");
    if (isDevelopmentBuild()) console.debug("[AuricPlayback] play requested", { trackId: track.id, itemId: nextItemId, nativeGeneration: generation });
    await audioEngine.play(generation);
    tracePlaybackMutation("native play requested", get, beforeNativeActivation, {
      intendedTrackId: track.id, activationGeneration: generation, force: true,
    });
    await audioEngine.waitUntilReady?.(generation);
    if (!activations.isCurrent(token, isNativeCurrent)) return false;
    // Android can accept Play while preparing without starting once Ready.
    // Reassert the same generation after readiness so a track tap always starts.
    await audioEngine.play(generation);
    await audioEngine.waitUntilPlaying?.(generation);
    tracePlaybackMutation("native play confirmed", get, beforeNativeActivation, {
      intendedTrackId: track.id, activationGeneration: generation, force: true,
    });
    const confirmedNative = audioEngine.getNativePlaybackSnapshot?.();
    if (confirmedNative?.nativeActiveMediaId !== nextItemId || confirmedNative?.nativeIsPlaying !== true) {
      throw new Error("NATIVE_PLAYBACK_DID_NOT_START");
    }
    if (!activations.isCurrent(token, isNativeCurrent)) return false;
    if (isDevelopmentBuild()) console.debug("[AuricPlayback] play confirmed", { trackId: track.id, itemId: nextItemId, nativeGeneration: generation, activeId: confirmedNative.nativeActiveMediaId, isPlaying: confirmedNative.nativeIsPlaying });
    let nativeStatus = audioEngine.getStatus();
    if (nativeStatus.itemId === nextItemId && nativeStatus.isPlaying !== true) {
      await audioEngine.waitUntilPlaying?.(generation);
      nativeStatus = audioEngine.getStatus();
    }
    if (!activations.isCurrent(token, isNativeCurrent)) return false;
    if (nativeStatus.itemId !== nextItemId || nativeStatus.isPlaying !== true) {
      throw new Error("NATIVE_PLAYBACK_DID_NOT_START");
    }
    if (previous.currentTrackId && endPreviousReason) {
      tracePlaybackMutation("listening session end on activation", get, previous, {
        intendedTrackId: previous.currentTrackId, activationGeneration: generation,
        force: true, details: { reason: endPreviousReason },
      });
      listeningTracker.end(endPreviousReason, previous.positionMs, {
        trackId: previous.currentTrackId,
        playbackItemId: previous.currentItemId,
      });
    }
    nativeTransitions.reset();
    if (newQueueSession || !queueSessionId) queueSessionId = generateUuid();
    if (replaceQueueOnStart) {
      useQueueStore.getState().replaceEntries(upcomingEntries, {
        persist: false,
        refill: false,
      });
    }
    setPlayback(set, get, () => ({
      currentTrackId: track.id,
      currentItemId: nextItemId,
      positionMs: 0,
      durationMs: track.durationMs || 0,
      isPlaying: true,
      isBuffering: nativeStatus.isBuffering,
      isLoading: nativeStatus.isLoaded !== true,
      playbackError: null,
      playbackContext: context,
      ...(shuffleModeOnStart !== undefined
        ? { shuffleMode: shuffleModeOnStart }
        : {}),
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
    }), "activation committed", { intendedTrackId: track.id, activationGeneration: generation,
      details: { activationSequence: token.sequence } });
    const committed = activations.commitAndTakeProjectionRequest(
      token,
      isNativeCurrent,
    );
    if (!committed.committed) return false;
    retryPlans.clear();
    if (isDevelopmentBuild()) console.debug("[AuricPlayback] activation committed", { trackId: track.id, itemId: nextItemId, activationSequence: token.sequence, nativeGeneration: generation, queueSize: useQueueStore.getState().entries.length });
    if (activationDiagnosticReason) {
      logPlaybackDiagnostic(activationDiagnosticReason, get);
    }
    listeningTracker.handleStatus(nativeStatus, context);
    checkpointGate.reset(Date.now());
    if (committed.nextRequested && get().currentItemId === nextItemId) {
      await get().next("skipped_next", nextItemId);
    }
    if (openFullPlayer) notifyExplicitPlaybackSelection(true);
    if (committed.projectionRequested) void syncNativeProjection(get);
    return true;
  } catch (error) {
    const isNativeCurrent = (value) =>
      audioEngine.isGenerationCurrent(value);
    if (activations.fail(token, isNativeCurrent)) {
      if (newQueueSession) queueSessionId = generateUuid();
      if (replaceQueueOnStart) {
        retryPlans.capture({
          trackId: track.id,
          itemId: nextItemId,
          context,
          upcomingEntries,
          replaceQueueOnStart: true,
          initialHistory,
          shuffleModeOnStart,
          newQueueSession,
          endPreviousReason,
        });
      }
      // Keep the selected context available to Retry and the Queue screen.
      // Rolling it back leaves the new selected track paired with the old queue.
      setPlayback(set, get, {
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
      }, "activation failed", { intendedTrackId: track.id, activationGeneration: token.generation,
        details: { activationSequence: token.sequence, code: error?.code || error?.message } });
      if (replaceQueueOnStart) {
        useQueueStore.getState().replaceEntries(upcomingEntries, {
          persist: false,
          refill: false,
        });
      }
      if (isDevelopmentBuild()) console.error("[AuricPlayback] activation failed", { trackId: track.id, code: error?.code || error?.message, logicalQueueSize: useQueueStore.getState().entries.length, native: audioEngine.getNativePlaybackSnapshot?.() });
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
        tracePlaybackMutation("native projection synchronized", get, state, {
          intendedTrackId: state.currentTrackId, force: true,
          details: { itemId, queueSize: useQueueStore.getState().entries.length },
        });
      } catch (error) {
        tracePlaybackMutation("native projection rejected", get, state, {
          intendedTrackId: state.currentTrackId, force: true,
          details: { itemId, code: error?.code || error?.message },
        });
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
  const ownerSelectionGeneration = playbackStateService.selectionGeneration;
  tracePlaybackMutation(`persistence ${mode} requested`, usePlayerStore.getState, state, {
    intendedTrackId: snapshot.current?.trackId,
    force: true,
    details: { ownerSelectionGeneration, itemId: snapshot.current?.id },
  });
  void saveJSON(STORAGE_KEYS.currentTrack, {
    trackId: state.currentTrackId,
    positionMs: state.positionMs,
    context: state.playbackContext,
    shuffleMode: state.shuffleMode,
  });
  try {
    const result = mode === "checkpoint"
      ? await playbackStateService.checkpoint(snapshot)
      : await playbackStateService.replace(snapshot);
    tracePlaybackMutation(`persistence ${mode} settled`, usePlayerStore.getState, state, {
      intendedTrackId: snapshot.current?.trackId,
      force: true,
      details: { ownerSelectionGeneration, itemId: snapshot.current?.id,
        accepted: Boolean(result), revision: result?.revision },
    });
    return result;
  } catch (error) {
    tracePlaybackMutation(`persistence ${mode} rejected`, usePlayerStore.getState, state, {
      intendedTrackId: snapshot.current?.trackId,
      force: true,
      details: { ownerSelectionGeneration, itemId: snapshot.current?.id,
        code: error?.code, status: error?.status, validation: error?.details },
    });
    return null;
  }
}

async function applyRestoredSnapshot(
  set,
  get,
  snapshot,
  { loadAudio = false, refillQueue = true, source = "restore" } = {},
) {
  const before = get();
  tracePlaybackMutation(`${source} requested`, get, before, {
    intendedTrackId: snapshot.current?.trackId,
    force: true,
    details: { snapshotItemId: snapshot.current?.id, revision: snapshot.revision },
  });
  if (loadAudio) coldRestoreDepth += 1;
  try {
    retryPlans.clear();
    activations.invalidate();
    audioEngine.cancelActivation?.();
    tracePlaybackMutation(`${source} native cancel`, get, before, { intendedTrackId: snapshot.current?.trackId, force: true });
    queueSessionId = snapshot.current?.id ?? null;
    const restored = await restorePlaybackSnapshot({
      snapshot,
      getTrack: (id) => useLibraryStore.getState().getTrackById(id),
      cacheTracks: (tracks) => useLibraryStore.getState().cacheTracks(tracks),
      hydrateQueue: (items) => useQueueStore.getState().hydrateSnapshot(items),
      setPlayer: (patch) => setPlayback(set, get, patch, source, {
        intendedTrackId: snapshot.current?.trackId,
      }),
      getCurrentTrackId: () => get().currentTrackId,
      audioEngine,
      isPlayable: isTrackPlayable,
      normalizePosition: normalizeRestoredPosition,
      playbackFailureMessage,
      loadAudio,
    });
    tracePlaybackMutation(`${source} applied`, get, before, {
      intendedTrackId: snapshot.current?.trackId,
      force: true,
      details: { restored },
    });
    if (refillQueue) void get().ensureQueueDepth();
    return restored;
  } finally {
    if (loadAudio) coldRestoreDepth -= 1;
  }
}

async function startRecommendation(set, get, mode) {
  retryPlans.clear();
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
    playbackStateService.markLocalChange();
    const activated = await activate(set, get, first, context, {
      pushCurrentToStack: false,
      endPreviousReason: "replaced",
      upcomingEntries,
      replaceQueueOnStart: true,
      initialHistory: [],
      shuffleModeOnStart: mode,
      newQueueSession: true,
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
          : mode === "smart"
            ? contextFor("smart_shuffle", "Smart Shuffle")
            : contextFor("smart_shuffle", "Recommended");
      useQueueStore
        .getState()
        .appendUnique(
          tracks.map((track) => track.id),
          context,
          { refill: false },
        );
    },
    isPlayable: isTrackPlayable,
    trace: (event, details) => {
      if (isDevelopmentBuild()) console.debug(`[AuricPlayback] ${event}`, details);
    },
  });
  return queueRefillCoordinator;
}

export default usePlayerStore;
