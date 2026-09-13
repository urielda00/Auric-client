const {
  NATIVE_SUCCESSOR_COUNT,
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
  }) {
    this.player = player;
    this.createSource = createSource;
    this.onAuthenticationFailure = onAuthenticationFailure;
    this.onSourceFailure = onSourceFailure;
    this.now = now;
    this.transitionTimeoutMs = transitionTimeoutMs;
    this.queueAcceptanceTimeoutMs = queueAcceptanceTimeoutMs;
    this.queueAcceptanceIntervalMs = queueAcceptanceIntervalMs;
    this.initialized = false;
    this.subscriptions = [];
    this.projection = [];
    this.nativeItems = [];
    this.trackId = null;
    this.itemId = null;
    this.generation = 0;
    this.suppressedActivationItemId = null;
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
        preloading: { window: NATIVE_SUCCESSOR_COUNT },
      },
      progressSync: { intervalSeconds: 1 },
      android: {
        wakeMode: "network",
        taskRemovedBehavior: "continue",
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
    this.generation += 1;
    const loadGeneration = this.generation;
    if (this.readyWaiter) {
      clearTimeout(this.readyWaiter.timeout);
      this.readyWaiter.reject(new Error("STALE_ACTIVATION"));
      this.readyWaiter = null;
    }
    this.projection = projection;
    this.nativeItems = nativeItems;
    this.trackId = track.id;
    this.itemId = current.itemId;
    this.suppressedActivationItemId = current.itemId;
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

  play() {
    this.initialize();
    if (!this.itemId) throw new Error("NO_AUDIO_LOADED");
    if (this.diagnostics && this.diagnostics.playRequestedAtMs === null) {
      this.diagnostics.playRequestedAtMs = this.now();
    }
    this.player.play();
  }

  waitUntilReady(generation = this.generation, timeoutMs = 15000) {
    if (generation !== this.generation)
      return Promise.reject(new Error("STALE_ACTIVATION"));
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

    let resolveTransition;
    let rejectTransition;
    const promise = new Promise((resolve, reject) => {
      resolveTransition = resolve;
      rejectTransition = reject;
    });
    const timeout = setTimeout(() => {
      if (this.pendingTransition?.expectedItemId !== nextItem.mediaId) return;
      this.pendingTransition = null;
      rejectTransition(new Error("NATIVE_TRANSITION_TIMEOUT"));
    }, this.transitionTimeoutMs);
    this.pendingTransition = {
      expectedItemId: nextItem.mediaId,
      reason,
      promise,
      resolve: resolveTransition,
      reject: rejectTransition,
      timeout,
    };
    try {
      this.player.skipToNext();
    } catch (error) {
      clearTimeout(timeout);
      this.pendingTransition = null;
      rejectTransition(error);
    }
    return promise;
  }

  syncQueue(current, upcoming = []) {
    if (!current?.track || !this.itemId) return false;
    const desired = buildNativeProjection({
      current,
      upcoming,
      getTrack: (trackId) =>
        upcoming.find((item) => item.trackId === trackId)?.track,
      isPlayable: (track) => track?.hasMedia === true,
    });
    const active = this.player.getActiveMediaItem();
    if (!active || active.mediaId !== current.itemId) return false;
    const initialActiveIndex = this.player.getActiveMediaItemIndex() ?? 0;
    if (sameProjection(this.projection, desired) && initialActiveIndex === 0) {
      return false;
    }

    const nextItems = desired.map((item) => nativeItem(item, this.createSource));
    let activeIndex = initialActiveIndex;
    if (activeIndex > 0) {
      this.player.removeMediaItems(0, activeIndex);
      activeIndex = 0;
    }
    const queue = this.player.getQueue();
    for (let index = 1; index < nextItems.length; index += 1) {
      const existing = queue[index];
      const desiredItem = nextItems[index];
      if (!existing) {
        this.player.addMediaItem(publicNativeItem(desiredItem));
      } else if (existing.mediaId !== desiredItem.mediaId) {
        this.player.replaceMediaItem(index, publicNativeItem(desiredItem));
      }
    }
    const currentQueueLength = this.player.getQueue().length;
    if (currentQueueLength > nextItems.length) {
      this.player.removeMediaItems(nextItems.length, currentQueueLength);
    }
    this.projection = desired;
    this.nativeItems = nextItems;
    return true;
  }

  handleNativeEvent(event) {
    if (event?.type !== EVENT.MEDIA_ITEM_TRANSITION && !this.itemId) {
      this._adoptActiveNativeState();
    }
    switch (event?.type) {
      case EVENT.PLAYBACK_STATE:
        return this._handlePlaybackState(event.state);
      case EVENT.IS_PLAYING:
        this.status.isPlaying = event.playing === true;
        if (
          this.status.isPlaying &&
          this.diagnostics &&
          this.diagnostics.playingAtMs === null
        ) {
          this.diagnostics.playingAtMs = this.now();
        }
        this._emitStatus();
        break;
      case EVENT.PROGRESS:
        if (event.mediaId !== this.itemId) return;
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
        return this.onRemoteNext?.();
      case EVENT.REMOTE_PREVIOUS:
        return this.onRemotePrevious?.();
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
        this.status.positionMs = Math.max(
          0,
          Math.round((progress.position || 0) * 1000),
        );
        this.status.durationMs = Math.max(
          0,
          Math.round((progress.duration || 0) * 1000),
        );
        this.status.isPlaying = this.player.isPlaying() === true;
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

  getDiagnostics() {
    return this.diagnostics ? { ...this.diagnostics } : null;
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
    do {
      if (generation !== this.generation)
        throw new Error("STALE_ACTIVATION");
      this.player.setMediaItems(items, 0);
      const queueIds = this.player.getQueue().map((item) => item.mediaId);
      if (
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
      backgroundWork = this.onEnded?.({
        trackId: this.trackId,
        itemId: this.itemId,
        generation: this.generation,
      });
    }
    this._emitStatus();
    return backgroundWork;
  }

  _handleTransition(event) {
    const transition = normalizedTransition(event);
    if (!transition?.trackId || !transition.itemId) return;
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
    if (pending?.expectedItemId === transition.itemId) {
      clearTimeout(pending.timeout);
      this.pendingTransition = null;
      pending.resolve(true);
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
    return backgroundWork;
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
    } catch {
      // A headless event may race the media-controller connection; the event
      // remains safe to ignore until the next native callback supplies state.
    }
  }

  _emitStatus() {
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
