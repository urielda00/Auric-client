const {
  NATIVE_PRELOAD_COUNT,
  buildNativeProjection,
  classifyPlaybackError,
  sameProjection,
} = require("./nativeQueuePolicy.cjs");

const DEFAULT_STATUS = Object.freeze({
  positionMs: 0,
  durationMs: 0,
  isPlaying: false,
  isBuffering: false,
  isLoaded: false,
  error: null,
});

const EVENT = Object.freeze({
  PLAYBACK_STATE: "event.playback-state-changed",
  IS_PLAYING: "event.is-playing-changed",
  MEDIA_ITEM_TRANSITION: "event.media-item-transition",
  PLAYBACK_ERROR: "event.playback-error",
  PROGRESS: "event.playback-progress-updated",
  REMOTE_NEXT: "event.remote-next",
  REMOTE_PREVIOUS: "event.remote-previous",
});

function bearerToken(source) {
  const header = source?.headers?.Authorization || source?.headers?.authorization;
  const match = typeof header === "string" ? /^Bearer\s+(.+)$/i.exec(header) : null;
  return match?.[1] || null;
}

function nativeItem(spec, createSource) {
  const source = createSource(spec.track);
  return {
    mediaId: spec.itemId,
    url: source,
    title: spec.track.title,
    artist: Array.isArray(spec.track.artists)
      ? spec.track.artists.join(", ")
      : "",
    albumTitle: spec.track.album || undefined,
    duration: Number.isFinite(spec.track.durationMs)
      ? spec.track.durationMs / 1000
      : undefined,
    mimeType: "audio/mp4",
    extras: {
      trackId: spec.track.id,
      itemId: spec.itemId,
      context: spec.context || null,
    },
    _authToken: bearerToken(source),
  };
}

function publicNativeItem(item) {
  const { _authToken, ...publicItem } = item;
  return publicItem;
}

function normalizedTransition(event) {
  const item = event?.item;
  if (!item) return null;
  return {
    trackId: item.extras?.trackId || null,
    itemId: item.extras?.itemId || item.mediaId || null,
    context: item.extras?.context || null,
    nativeIndex: Number.isInteger(event.index) ? event.index : null,
  };
}

class TrackPlayerAudioEngineCore {
  constructor({
    player,
    createSource,
    onAuthenticationFailure = () => {},
    onSourceFailure = async () => false,
    now = Date.now,
    transitionTimeoutMs = 8000,
    queueAcceptanceTimeoutMs = 2000,
    queueAcceptanceIntervalMs = 25,
    explicitPlayTimeoutMs = 4000,
    explicitPlayIntervalMs = 25,
  }) {
    this.player = player;
    this.createSource = createSource;
    this.onAuthenticationFailure = onAuthenticationFailure;
    this.onSourceFailure = onSourceFailure;
    this.now = now;
    this.transitionTimeoutMs = transitionTimeoutMs;
    this.queueAcceptanceTimeoutMs = queueAcceptanceTimeoutMs;
    this.queueAcceptanceIntervalMs = queueAcceptanceIntervalMs;
    this.explicitPlayTimeoutMs = explicitPlayTimeoutMs;
    this.explicitPlayIntervalMs = explicitPlayIntervalMs;
    this.initialized = false;
    this.subscriptions = [];
    this.projection = [];
    this.nativeItems = [];
    this.trackId = null;
    this.itemId = null;
    this.generation = 0;
    this.suppressedActivationItemId = null;
    this.silentRestoreItemId = null;
    this.hasPlayedCurrentItem = false;
    this.pendingTransition = null;
    this.readyWaiter = null;
    this.authenticationFailures = new Set();
    this.sourceFailureChecks = new Set();
    this.onStatus = null;
    this.onEnded = null;
    this.onTrackChanged = null;
    this.onRemoteNext = null;
    this.onRemotePrevious = null;
    this.status = { ...DEFAULT_STATUS };
    this.diagnostics = null;
  }

  initialize() {
    if (this.initialized) return;
    this.player.setupPlayer({
      contentType: "music",
      handleAudioBecomingNoisy: true,
      audioMixing: "exclusive",
      cache: {
        maxSizeBytes: 256 * 1024 * 1024,
        preloading: { window: NATIVE_PRELOAD_COUNT },
      },
      progressSync: { intervalSeconds: 1 },
      android: {
        wakeMode: "network",
        taskRemovedBehavior: "stop",
        notification: {
          channelId: "com.auric.player.playback",
          channelName: "Auric playback",
          smallIcon: "ic_stat_music_note",
        },
      },
    });
    this.player.setCommands({
      capabilities: [
        this.player.commands.Previous,
        this.player.commands.PlayPause,
        this.player.commands.Next,
      ],
      handling: "hybrid",
      perCommandHandling: {
        [this.player.commands.Next]: "js",
        [this.player.commands.Previous]: "js",
      },
    });
    this._subscribe();
    this.initialized = true;
  }

  async load(track, options = {}) {
    if (!track || track.hasMedia !== true)
      throw new Error("TRACK_HAS_NO_MEDIA");
    this.initialize();
    const current = {
      track,
      itemId: options.currentItemId || track.id,
      context: options.context || null,
    };
    const projection = buildNativeProjection({
      current,
      upcoming: options.upcoming || [],
      getTrack: options.getTrack,
      isPlayable: (candidate) => candidate?.hasMedia === true,
    });
    const startedAt = this.now();
    const nativeItems = projection.map((item) =>
      nativeItem(item, this.createSource),
    );
    const reservedGeneration = options.activationGeneration;
    const loadGeneration = Number.isInteger(reservedGeneration)
      ? reservedGeneration
      : this._beginGeneration();
    if (loadGeneration !== this.generation) {
      throw new Error("STALE_ACTIVATION");
    }
    this.projection = projection;
    this.nativeItems = nativeItems;
    this.trackId = track.id;
    this.itemId = current.itemId;
    this.suppressedActivationItemId = current.itemId;
    this.silentRestoreItemId = options.silentRestore ? current.itemId : null;
    this.hasPlayedCurrentItem = false;
    this.status = {
      ...DEFAULT_STATUS,
      durationMs: Number.isFinite(track.durationMs) ? track.durationMs : 0,
      isBuffering: true,
    };
    this.diagnostics = {
      trackId: track.id,
      loadRequestedAtMs: startedAt,
      sourceCreatedAtMs: this.now(),
      nativeQueueSetAtMs: null,
      nativeQueueAcceptedAtMs: null,
      playRequestedAtMs: null,
      readyAtMs: null,
      playingAtMs: null,
      firstProgressAtMs: null,
    };
    this._emitStatus();
    this.diagnostics.nativeQueueSetAtMs = this.now();
    await this._setQueueWhenControllerReady(
      nativeItems.map(publicNativeItem),
      loadGeneration,
    );
    this.diagnostics.nativeQueueAcceptedAtMs = this.now();
    return loadGeneration;
  }

  async restorePaused(track, options = {}) {
    this.silentRestoreItemId = options.currentItemId || track.id;
    this.initialize();
    this.player.pause();
    try {
      await this.load(track, { ...options, silentRestore: true });
      this.seekTo(options.positionMs || 0);
      this.status.positionMs = Math.max(0, options.positionMs || 0);
      this.player.pause();
      const active = this.player.getActiveMediaItem?.();
      if (active?.mediaId !== this.silentRestoreItemId) {
        throw new Error("NATIVE_QUEUE_NOT_READY");
      }
      this.suppressedActivationItemId = null;
    } catch (error) {
      this.silentRestoreItemId = null;
      throw error;
    }
  }

  beginActivation() {
    this.initialize();
    this.silentRestoreItemId = null;
    const generation = this._beginGeneration();
    if (this.itemId) {
      this.player.pause();
      this.status.isPlaying = false;
    }
    return generation;
  }

  cancelActivation() {
    this.silentRestoreItemId = null;
    const generation = this._beginGeneration();
    if (this.initialized && this.itemId) {
      this.player.pause();
      this.status.isPlaying = false;
    }
    return generation;
  }

  isGenerationCurrent(generation) {
    return generation === this.generation;
  }

  play(generation) {
    this.initialize();
    if (
      Number.isInteger(generation) &&
      !this.isGenerationCurrent(generation)
    ) {
      throw new Error("STALE_ACTIVATION");
    }
    if (!this.itemId) throw new Error("NO_AUDIO_LOADED");
    if (this.silentRestoreItemId) {
      if (this.player.getActiveMediaItem?.()?.mediaId !== this.itemId) {
        throw new Error("NATIVE_QUEUE_NOT_READY");
      }
      this.silentRestoreItemId = null;
    }
    if (this.diagnostics && this.diagnostics.playRequestedAtMs === null) {
      this.diagnostics.playRequestedAtMs = this.now();
    }
    this.player.play();
  }

  waitUntilReady(generation = this.generation, timeoutMs = 15000) {
    if (generation !== this.generation)
      return Promise.reject(new Error("STALE_ACTIVATION"));
    try {
      if (this.player.getPlaybackState?.() === "ready") {
        this.status.isLoaded = true;
        this.status.isBuffering = false;
      }
    } catch {
      // Fall through to event-driven readiness while the controller reconnects.
    }
    if (this.status.isLoaded) return Promise.resolve(true);
    if (this.status.error)
      return Promise.reject(new Error(this.status.error.code));
    if (this.readyWaiter?.generation === generation) {
      return this.readyWaiter.promise;
    }
    let resolveReady;
    let rejectReady;
    const promise = new Promise((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const timeout = setTimeout(() => {
      if (this.readyWaiter?.generation !== generation) return;
      this.readyWaiter = null;
      rejectReady(new Error("NATIVE_PREPARE_TIMEOUT"));
    }, timeoutMs);
    this.readyWaiter = {
      generation,
      promise,
      resolve: resolveReady,
      reject: rejectReady,
      timeout,
    };
    return promise;
  }

  async waitUntilPlaying(generation = this.generation, timeoutMs = 15000) {
    const deadline = this.now() + timeoutMs;
    let nextPlayAt = this.now() + 250;
    do {
      if (!this.isGenerationCurrent(generation))
        throw new Error("STALE_ACTIVATION");
      if (this.status.error) throw new Error(this.status.error.code);
      let active = null;
      try {
        active = this.player.getActiveMediaItem?.();
      } catch {
        // Keep waiting while Android reconnects the media controller.
      }
      if (active?.mediaId && active.mediaId !== this.itemId)
        throw new Error("STALE_ACTIVATION");
      try {
        if (active?.mediaId === this.itemId && this.player.isPlaying() === true) {
          this.status.isPlaying = true;
          this.hasPlayedCurrentItem = true;
          this._emitStatus();
          return true;
        }
      } catch {
        // The controller may briefly reconnect after accepting the queue.
      }
      if (this.now() >= nextPlayAt) {
        this.play(generation);
        nextPlayAt = this.now() + 500;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    } while (this.now() < deadline);
    throw new Error("NATIVE_PLAYBACK_DID_NOT_START");
  }

  pause() {
    if (!this.initialized) return;
    this.player.pause();
  }

  seekTo(ms) {
    if (!this.itemId) throw new Error("NO_AUDIO_LOADED");
    this.player.seekTo(Math.max(0, ms) / 1000);
  }

  next(reason = "skipped_next") {
    if (this.pendingTransition) return this.pendingTransition.promise;
    const currentIndex = this.player.getActiveMediaItemIndex();
    const queue = this.player.getQueue();
    const nextItem = queue[currentIndex + 1];
    if (!nextItem) return Promise.resolve(false);
    this.silentRestoreItemId = null;

    let resolveTransition;
    let rejectTransition;
    const transition = new Promise((resolve, reject) => {
      resolveTransition = resolve;
      rejectTransition = reject;
    });
    const request = transition.then(({ generation }) =>
      this._playExplicitSuccessor(generation),
    );
    const timeout = setTimeout(() => {
      if (
        this.pendingTransition?.expectedItemId !== nextItem.mediaId ||
        this.pendingTransition.transitioned
      )
        return;
      rejectTransition(new Error("NATIVE_TRANSITION_TIMEOUT"));
    }, this.transitionTimeoutMs);
    const pending = {
      expectedItemId: nextItem.mediaId,
      reason,
      promise: null,
      resolve: resolveTransition,
      reject: rejectTransition,
      timeout,
      transitioned: false,
    };
    const promise = request.finally(() => {
      if (this.pendingTransition === pending) this.pendingTransition = null;
    });
    pending.promise = promise;
    this.pendingTransition = pending;
    try {
      this.player.skipToNext();
    } catch (error) {
      clearTimeout(timeout);
      this.pendingTransition = null;
      rejectTransition(error);
    }
    return promise;
  }

  async syncQueue(current, upcoming = []) {
    if (!current?.track || !this.itemId) return false;
    const desired = buildNativeProjection({
      current,
      upcoming,
      getTrack: (trackId) =>
        upcoming.find((item) => item.trackId === trackId)?.track,
      isPlayable: (track) => track?.hasMedia === true,
    });
    const nextItems = desired.map((item) => nativeItem(item, this.createSource));
    if (
      this.silentRestoreItemId === current.itemId &&
      this.player.getActiveMediaItem?.()?.mediaId !== current.itemId
    ) {
      await this._setQueueWhenControllerReady(
        nextItems.map(publicNativeItem),
        this.generation,
      );
      this.projection = desired;
      this.nativeItems = nextItems;
      this.seekTo(this.status.positionMs);
      this.player.pause();
      return true;
    }
    return this._syncQueueWhenControllerReady(
      current,
      desired,
      nextItems,
      this.generation,
    );
  }

  handleNativeEvent(event) {
    let adopted = null;
    if (event?.type !== EVENT.MEDIA_ITEM_TRANSITION && !this.itemId) {
      adopted = this._adoptActiveNativeState();
    }
    switch (event?.type) {
      case EVENT.PLAYBACK_STATE:
        return this._handlePlaybackState(event.state);
      case EVENT.IS_PLAYING:
        this.status.isPlaying = event.playing === true;
        if (!this.status.isPlaying) {
          try {
            // Android can deliver A's final paused event after B has already
            // honored explicit play. Never let that stale event overwrite the
            // active player's authoritative playing state.
            this.status.isPlaying = this.player.isPlaying() === true;
          } catch {
            // Keep the event-derived state while the controller reconnects.
          }
        }
        if (
          this.status.isPlaying &&
          this.diagnostics &&
          this.diagnostics.playingAtMs === null
        ) {
          this.diagnostics.playingAtMs = this.now();
        }
        if (this.status.isPlaying && !this.silentRestoreItemId) {
          try {
            if (this.player.getActiveMediaItem?.()?.mediaId === this.itemId) {
              this.hasPlayedCurrentItem = true;
            }
          } catch {
            // Wait for the controller to reconnect before confirming playback.
          }
        }
        this._emitStatus();
        break;
      case EVENT.PROGRESS:
        if (event.mediaId !== this.itemId) return;
        if (this.silentRestoreItemId) return;
        this.status.positionMs = Math.max(0, Math.round(event.position * 1000));
        this.status.durationMs = Math.max(0, Math.round(event.duration * 1000));
        if (this.diagnostics?.firstProgressAtMs === null) {
          this.diagnostics.firstProgressAtMs = this.now();
        }
        this._emitStatus();
        break;
      case EVENT.MEDIA_ITEM_TRANSITION:
        return this._handleTransition(event);
      case EVENT.PLAYBACK_ERROR:
        return this._handleError(event);
      case EVENT.REMOTE_NEXT:
        return this._handleRemoteCommand(adopted, this.onRemoteNext);
      case EVENT.REMOTE_PREVIOUS:
        return this._handleRemoteCommand(adopted, this.onRemotePrevious);
      default:
        return undefined;
    }
  }

  setOnStatus(fn) {
    this.onStatus = fn;
  }

  setOnEnded(fn) {
    this.onEnded = fn;
  }

  setOnTrackChanged(fn) {
    this.onTrackChanged = fn;
  }

  setOnRemoteNext(fn) {
    this.onRemoteNext = fn;
  }

  setOnRemotePrevious(fn) {
    this.onRemotePrevious = fn;
  }

  getStatus() {
    if (this.itemId) {
      try {
        const progress = this.player.getProgress();
        if (!this.silentRestoreItemId) {
          this.status.positionMs = Math.max(
            0,
            Math.round((progress.position || 0) * 1000),
          );
        }
        this.status.durationMs = Math.max(
          0,
          Math.round((progress.duration || 0) * 1000),
        );
        this.status.isPlaying = this.player.isPlaying() === true;
        if (this.status.isPlaying && !this.silentRestoreItemId &&
          this.player.getActiveMediaItem?.()?.mediaId === this.itemId) {
          this.hasPlayedCurrentItem = true;
        }
        if (
          this.silentRestoreItemId &&
          this.player.getActiveMediaItem?.()?.mediaId !== this.itemId
        ) {
          this.status.isLoaded = false;
        }
      } catch {
        // The last event-derived status remains valid while the service reconnects.
      }
    }
    return {
      ...this.status,
      trackId: this.trackId,
      itemId: this.itemId,
      generation: this.generation,
    };
  }

  isSilentRestore() {
    return this.silentRestoreItemId !== null;
  }

  getDiagnostics() {
    return this.diagnostics ? { ...this.diagnostics } : null;
  }

  getNativePlaybackSnapshot() {
    let active = null;
    let activeIndex = null;
    let queue = [];
    let isPlaying = false;
    try {
      // Bypass cached projection and event-derived state. RNTP is the source
      // of truth for queue synchronization and real-device diagnostics.
      active = this.player.getActiveMediaItem?.() || null;
      activeIndex = this.player.getActiveMediaItemIndex?.() ?? null;
      queue = this.player.getQueue?.() || [];
      isPlaying = this.player.isPlaying?.() === true;
    } catch {
      // A controller reconnect can make one diagnostic read temporarily empty.
    }
    return {
      nativeActiveMediaId:
        active?.extras?.itemId || active?.mediaId || null,
      nativeActiveIndex: activeIndex,
      nativeQueueMediaIds: queue
        .map((item) => item.extras?.itemId || item.mediaId)
        .filter(Boolean),
      nativeIsPlaying: isPlaying,
    };
  }

  destroy() {
    this.subscriptions.forEach((subscription) => subscription?.remove?.());
    this.subscriptions = [];
    if (this.pendingTransition) {
      clearTimeout(this.pendingTransition.timeout);
      this.pendingTransition.reject(new Error("AUDIO_ENGINE_DESTROYED"));
      this.pendingTransition = null;
    }
    if (this.readyWaiter) {
      clearTimeout(this.readyWaiter.timeout);
      this.readyWaiter.reject(new Error("AUDIO_ENGINE_DESTROYED"));
      this.readyWaiter = null;
    }
    this.onStatus = null;
    this.onEnded = null;
    this.onTrackChanged = null;
    this.onRemoteNext = null;
    this.onRemotePrevious = null;
  }

  _beginGeneration() {
    this.generation += 1;
    if (this.pendingTransition) {
      clearTimeout(this.pendingTransition.timeout);
      this.pendingTransition.reject(new Error("STALE_ACTIVATION"));
      this.pendingTransition = null;
    }
    if (this.readyWaiter) {
      clearTimeout(this.readyWaiter.timeout);
      this.readyWaiter.reject(new Error("STALE_ACTIVATION"));
      this.readyWaiter = null;
    }
    return this.generation;
  }

  _subscribe() {
    Object.values(EVENT).forEach((type) => {
      this.subscriptions.push(
        this.player.addEventListener(type, (payload = {}) =>
          this.handleNativeEvent({ type, ...payload }),
        ),
      );
    });
  }

  async _setQueueWhenControllerReady(items, generation) {
    const expectedIds = items.map((item) => item.mediaId);
    const deadline = this.now() + this.queueAcceptanceTimeoutMs;
    let nextSetAt = -Infinity;
    do {
      if (generation !== this.generation)
        throw new Error("STALE_ACTIVATION");
      // Android dispatches setMediaItems and prepare asynchronously. Repeating
      // both on every 25 ms poll can reset preparation before Play takes hold.
      if (this.now() >= nextSetAt) {
        this.player.setMediaItems(items, 0);
        nextSetAt = this.now() + 500;
      }
      const queueIds = this.player.getQueue().map((item) => item.mediaId);
      if (
        this.player.getActiveMediaItemIndex?.() === 0 &&
        this.player.getActiveMediaItem?.()?.mediaId === expectedIds[0] &&
        queueIds.length === expectedIds.length &&
        queueIds.every((id, index) => id === expectedIds[index])
      ) {
        return;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, this.queueAcceptanceIntervalMs),
      );
    } while (this.now() < deadline);
    throw new Error("NATIVE_QUEUE_NOT_READY");
  }

  async _syncQueueWhenControllerReady(
    current,
    desired,
    nextItems,
    generation,
  ) {
    const expectedIds = nextItems.map((item) => item.mediaId);
    const maxObservedChanges = Math.max(
      16,
      4 * (expectedIds.length + this.player.getQueue().length + 1),
    );
    let observedChanges = 0;
    let lastObservedQueue = null;
    let stallDeadline = this.now() + this.queueAcceptanceTimeoutMs;
    let mutated = false;
    do {
      if (generation !== this.generation) {
        throw new Error("STALE_PROJECTION");
      }
      const active = this.player.getActiveMediaItem?.();
      const activeIndex = this.player.getActiveMediaItemIndex?.();
      if (!active) {
        await new Promise((resolve) =>
          setTimeout(resolve, this.queueAcceptanceIntervalMs),
        );
        continue;
      }
      if (active.mediaId !== current.itemId) {
        if (active.mediaId !== this.itemId) {
          void this._handleTransition({ item: active, index: activeIndex });
        } else {
          // A cold headless adoption can know RNTP's active item before Zustand
          // has consumed the missed transition. Notify the canonical store from
          // the native path; its transition tracker keeps history idempotent.
          void this._notifyAdoptedActiveItem(active, activeIndex);
        }
        return false;
      }

      const queue = this.player.getQueue();
      const queueIds = queue.map((item) => item.mediaId);
      const observedQueue = `${activeIndex}:${queueIds.join(">")}`;
      if (observedQueue !== lastObservedQueue) {
        lastObservedQueue = observedQueue;
        observedChanges += 1;
        if (observedChanges > maxObservedChanges) {
          throw new Error("NATIVE_QUEUE_NOT_READY");
        }
        stallDeadline = this.now() + this.queueAcceptanceTimeoutMs;
      }
      if (
        activeIndex === 0 &&
        queueIds.length === expectedIds.length &&
        queueIds.every((id, index) => id === expectedIds[index])
      ) {
        const changed = mutated || !sameProjection(this.projection, desired);
        this.projection = desired;
        this.nativeItems = nextItems;
        return changed;
      }

      // Apply one idempotent mutation per observation. RNTP's Android bridge
      // posts queue writes to the main-thread MediaController, so immediately
      // caching the desired projection can otherwise outrun native acceptance.
      if (Number.isInteger(activeIndex) && activeIndex > 0) {
        this.player.removeMediaItems(0, activeIndex);
        mutated = true;
      } else {
        const mismatch = expectedIds.findIndex(
          (id, index) => queueIds[index] !== id,
        );
        if (mismatch >= 1 && mismatch < queue.length) {
          this.player.replaceMediaItem(
            mismatch,
            publicNativeItem(nextItems[mismatch]),
          );
          mutated = true;
        } else if (mismatch >= 1) {
          this.player.addMediaItem(publicNativeItem(nextItems[mismatch]));
          mutated = true;
        } else if (queue.length > nextItems.length) {
          this.player.removeMediaItems(nextItems.length, queue.length);
          mutated = true;
        }
      }
      await new Promise((resolve) =>
        setTimeout(resolve, this.queueAcceptanceIntervalMs),
      );
    } while (this.now() < stallDeadline);
    throw new Error("NATIVE_QUEUE_NOT_READY");
  }

  async _playExplicitSuccessor(generation) {
    await this.waitUntilReady(generation);
    if (!this.isGenerationCurrent(generation)) {
      throw new Error("STALE_ACTIVATION");
    }
    this.play(generation);
    const deadline = this.now() + this.explicitPlayTimeoutMs;
    do {
      if (!this.isGenerationCurrent(generation)) {
        throw new Error("STALE_ACTIVATION");
      }
      try {
        if (this.player.isPlaying() === true) {
          this.status.isPlaying = true;
          this.hasPlayedCurrentItem = true;
          this._emitStatus();
          return true;
        }
      } catch {
        if (this.status.isPlaying) return true;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, this.explicitPlayIntervalMs),
      );
    } while (this.now() < deadline);
    throw new Error("NATIVE_PLAYBACK_DID_NOT_START");
  }

  _handleRemoteCommand(adopted, callback) {
    if (!adopted) return callback?.();
    const reconciliation = this._notifyAdoptedActiveItem(
      adopted.active,
      adopted.activeIndex,
    );
    return Promise.resolve(reconciliation).then(() => callback?.());
  }

  _handlePlaybackState(state) {
    let backgroundWork;
    if (state === "ready") {
      this.status.isLoaded = true;
      this.status.isBuffering = false;
      if (this.diagnostics?.readyAtMs === null) {
        this.diagnostics.readyAtMs = this.now();
      }
      if (this.readyWaiter?.generation === this.generation) {
        clearTimeout(this.readyWaiter.timeout);
        this.readyWaiter.resolve(true);
        this.readyWaiter = null;
      }
    } else if (state === "buffering") {
      this.status.isBuffering = true;
    } else if (state === "idle") {
      this.status.isLoaded = false;
      this.status.isBuffering = false;
    } else if (state === "ended") {
      this.status.isPlaying = false;
      this.status.isBuffering = false;
      let activeId = null;
      let nativeState = null;
      try {
        activeId = this.player.getActiveMediaItem?.()?.mediaId;
        nativeState = this.player.getPlaybackState?.();
      } catch {
        // A stopped service has no active media item to complete.
      }
      if (!this.silentRestoreItemId && this.hasPlayedCurrentItem &&
        this.itemId && activeId === this.itemId && nativeState === "ended") {
        backgroundWork = this.onEnded?.({
          trackId: this.trackId,
          itemId: this.itemId,
          generation: this.generation,
        });
      }
    }
    this._emitStatus();
    return backgroundWork;
  }

  _handleTransition(event) {
    const transition = normalizedTransition(event);
    if (!transition?.trackId || !transition.itemId) return;
    if (this.silentRestoreItemId) {
      if (transition.itemId === this.silentRestoreItemId) {
        this.suppressedActivationItemId = null;
      }
      return;
    }
    if (
      this.suppressedActivationItemId &&
      transition.itemId !== this.suppressedActivationItemId
    ) {
      return;
    }
    const activeItem = this.player.getActiveMediaItem?.();
    if (activeItem?.mediaId && activeItem.mediaId !== transition.itemId) return;
    const nativeQueue = this._readNativeQueue();
    const nativeItemIds = nativeQueue
      .slice(0, Math.max(0, (transition.nativeIndex ?? 0) + 1))
      .map((item) => item.extras?.itemId || item.mediaId)
      .filter(Boolean);
    const previousNativeItem =
      !this.itemId &&
      Number.isInteger(transition.nativeIndex) &&
      transition.nativeIndex > 0
        ? nativeQueue[transition.nativeIndex - 1]
        : null;
    const previousTrackId =
      this.trackId || previousNativeItem?.extras?.trackId || null;
    const previousItemId =
      this.itemId ||
      previousNativeItem?.extras?.itemId ||
      previousNativeItem?.mediaId ||
      null;
    this.trackId = transition.trackId;
    this.itemId = transition.itemId;
    this.hasPlayedCurrentItem = false;
    const suppressed = this.suppressedActivationItemId === transition.itemId;
    if (!suppressed) this.generation += 1;
    this.status = {
      ...DEFAULT_STATUS,
      isBuffering: true,
      isPlaying: this.status.isPlaying,
    };
    const pending = this.pendingTransition;
    const reason =
      pending?.expectedItemId === transition.itemId
        ? pending.reason
        : "completed";
    if (
      pending?.expectedItemId === transition.itemId &&
      !pending.transitioned
    ) {
      clearTimeout(pending.timeout);
      pending.transitioned = true;
    }
    if (suppressed) {
      this.suppressedActivationItemId = null;
      this._emitStatus();
      return;
    }
    if (this.projection.length) {
      this.projection = this.projection.slice(
        Math.max(
          0,
          this.projection.findIndex((item) => item.itemId === transition.itemId),
        ),
      );
      this.nativeItems = this.nativeItems.slice(
        Math.max(
          0,
          this.nativeItems.findIndex((item) => item.mediaId === transition.itemId),
        ),
      );
    } else {
      const activeIndex = Math.max(0, transition.nativeIndex || 0);
      const activeTail = nativeQueue.slice(activeIndex);
      this.projection = activeTail.map((item) => ({
        itemId: item.extras?.itemId || item.mediaId,
        context: item.extras?.context || null,
        isCurrent: item.mediaId === transition.itemId,
      }));
      this.nativeItems = activeTail.map((item) => ({
        ...item,
        _authToken: bearerToken(item.url),
      }));
    }
    const backgroundWork = this.onTrackChanged?.({
      ...transition,
      nativeItemIds,
      previousTrackId,
      previousItemId,
      reason,
      generation: this.generation,
    });
    this._emitStatus();
    if (pending?.transitioned) {
      pending.resolve({ generation: this.generation });
    }
    return backgroundWork;
  }

  _notifyAdoptedActiveItem(active, activeIndex) {
    const nativeQueue = this._readNativeQueue();
    const nativeItemIds = nativeQueue
      .slice(0, Math.max(0, (activeIndex ?? 0) + 1))
      .map((item) => item.extras?.itemId || item.mediaId)
      .filter(Boolean);
    return this.onTrackChanged?.({
      trackId: active.extras?.trackId || null,
      itemId: active.extras?.itemId || active.mediaId || null,
      context: active.extras?.context || null,
      nativeIndex: activeIndex,
      nativeItemIds,
      previousTrackId: null,
      previousItemId: null,
      reason: "completed",
      generation: this.generation,
    });
  }

  _handleError(event) {
    const error = classifyPlaybackError(event);
    const failedItemId = this.itemId;
    const failedTrackId = this.trackId;
    const failedToken = this.nativeItems.find(
      (item) => item.mediaId === failedItemId,
    )?._authToken;
    this.status = {
      ...this.status,
      isPlaying: false,
      isBuffering: false,
      error,
    };
    if (this.pendingTransition) {
      clearTimeout(this.pendingTransition.timeout);
      this.pendingTransition.reject(new Error(error.code));
      this.pendingTransition = null;
    }
    if (this.readyWaiter?.generation === this.generation) {
      clearTimeout(this.readyWaiter.timeout);
      this.readyWaiter.reject(new Error(error.code));
      this.readyWaiter = null;
    }
    let backgroundWork;
    if (error.kind === "authentication") {
      backgroundWork = this._reportAuthenticationFailure(
        failedItemId,
        failedToken,
      );
    } else if (error.kind === "source") {
      const sourceFailureKey = `${failedItemId}:${failedToken || "missing"}`;
      if (this.sourceFailureChecks.has(sourceFailureKey)) {
        this._emitStatus();
        return;
      }
      this.sourceFailureChecks.add(sourceFailureKey);
      backgroundWork = Promise.resolve(
        this.onSourceFailure({
          trackId: failedTrackId,
          itemId: failedItemId,
          failedToken,
        }),
      ).then((authenticationFailed) => {
        if (!authenticationFailed || this.itemId !== failedItemId) return;
        this.status.error = {
          code: "AUTHENTICATION_REQUIRED",
          kind: "authentication",
          retryable: false,
        };
        return this._reportAuthenticationFailure(failedItemId, failedToken);
      }).then(() => {
        this._emitStatus();
      });
    }
    this._emitStatus();
    return backgroundWork;
  }

  _reportAuthenticationFailure(itemId, failedToken) {
    const key = `${itemId}:${failedToken || "missing"}`;
    if (this.authenticationFailures.has(key)) return undefined;
    this.authenticationFailures.add(key);
    return this.onAuthenticationFailure(failedToken);
  }

  _readNativeQueue() {
    try {
      return this.player.getQueue?.() || [];
    } catch {
      return [];
    }
  }

  _adoptActiveNativeState() {
    try {
      const active = this.player.getActiveMediaItem?.();
      if (!active) return;
      this.trackId = active.extras?.trackId || null;
      this.itemId = active.extras?.itemId || active.mediaId || null;
      const queue = this._readNativeQueue();
      this.nativeItems = queue.map((item) => ({
        ...item,
        _authToken: bearerToken(item.url),
      }));
      this.projection = queue.map((item) => ({
        itemId: item.extras?.itemId || item.mediaId,
        context: item.extras?.context || null,
        isCurrent: item.mediaId === this.itemId,
      }));
      return {
        active,
        activeIndex: this.player.getActiveMediaItemIndex?.() ?? 0,
      };
    } catch {
      // A headless event may race the media-controller connection; the event
      // remains safe to ignore until the next native callback supplies state.
    }
    return null;
  }

  _emitStatus() {
    if (this.silentRestoreItemId) return;
    this.onStatus?.({
      ...this.status,
      trackId: this.trackId,
      itemId: this.itemId,
      generation: this.generation,
    });
  }
}

module.exports = {
  EVENT,
  TrackPlayerAudioEngineCore,
  normalizedTransition,
};
