const CHECKPOINT_INTERVAL_MS = 30_000;
const PAUSE_CHECKPOINT_MINIMUM_MS = 5_000;
const PERSIST_INTERVAL_MS = 5_000;
const MAX_STATUS_SAMPLE_GAP_MS = 2_000;
const MAX_MILLISECONDS = Number.MAX_SAFE_INTEGER;
const ENDED_REASONS = new Set([
  'completed',
  'skipped_next',
  'skipped_previous',
  'replaced',
  'stopped',
  'app_closed',
  'error',
]);

const CONTEXT_MAP = Object.freeze({
  direct: 'direct',
  home: 'direct',
  search: 'search',
  liked: 'liked_songs',
  liked_songs: 'liked_songs',
  history: 'history',
  play_next: 'play_next',
  manual_queue: 'manual_queue',
  resume: 'resume',
  randomShuffle: 'random_shuffle',
  random_shuffle: 'random_shuffle',
  smartShuffle: 'smart_shuffle',
  smart_shuffle: 'smart_shuffle',
  recommendation: 'smart_shuffle',
  quickPicks: 'quick_pick',
  quick_pick: 'quick_pick',
});

function normalizeListeningContext(context) {
  const type = typeof context === 'string' ? context : context?.type;
  return CONTEXT_MAP[type] || 'direct';
}

function serializable(session) {
  return {
    id: session.id,
    trackId: session.trackId,
    playbackItemId: session.playbackItemId || null,
    context: session.context,
    startedAtMs: session.startedAtMs,
    startPositionMs: session.startPositionMs,
    positionMs: session.positionMs,
    durationMs: session.durationMs,
    listenedMs: session.listenedMs,
    endedReason: session.endedReason || null,
  };
}

function normalizeMilliseconds(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.min(MAX_MILLISECONDS, Math.round(numeric));
}

function sameOwner(session, owner) {
  if (!owner) return true;
  if (owner.sessionId && owner.sessionId !== session.id) return false;
  if (owner.trackId && owner.trackId !== session.trackId) return false;
  if (
    owner.playbackItemId &&
    session.playbackItemId &&
    owner.playbackItemId !== session.playbackItemId
  ) {
    return false;
  }
  return true;
}

function validPending(value) {
  return Boolean(
    value &&
      typeof value.id === 'string' &&
      typeof value.trackId === 'string' &&
      Number.isFinite(value.listenedMs) &&
      value.listenedMs >= 0,
  );
}

class ListeningSessionTracker {
  constructor({
    api,
    storage,
    createId,
    now = Date.now,
    enabled = true,
    onStarted = () => {},
    onError = () => {},
    checkpointIntervalMs = CHECKPOINT_INTERVAL_MS,
    pauseCheckpointMinimumMs = PAUSE_CHECKPOINT_MINIMUM_MS,
    persistIntervalMs = PERSIST_INTERVAL_MS,
    maxStatusSampleGapMs = MAX_STATUS_SAMPLE_GAP_MS,
  }) {
    this.api = api;
    this.storage = storage;
    this.createId = createId;
    this.now = now;
    this.enabled = enabled;
    this.onStarted = onStarted;
    this.onError = onError;
    this.checkpointIntervalMs = checkpointIntervalMs;
    this.pauseCheckpointMinimumMs = pauseCheckpointMinimumMs;
    this.persistIntervalMs = persistIntervalMs;
    this.maxStatusSampleGapMs = maxStatusSampleGapMs;
    this.active = null;
    this.pending = new Map();
    this.persistChain = Promise.resolve();
  }

  async recoverPending() {
    if (!this.enabled) return;
    const stored = await this.storage.load();
    const recoveredAtMs = this.now();
    const snapshots = (Array.isArray(stored) ? stored : stored ? [stored] : [])
      .filter(validPending)
      .map((snapshot) => ({
        ...snapshot,
        playbackItemId:
          typeof snapshot.playbackItemId === 'string'
            ? snapshot.playbackItemId
            : null,
        context: normalizeListeningContext(snapshot.context),
        startedAtMs: normalizeMilliseconds(
          snapshot.startedAtMs ?? recoveredAtMs - snapshot.listenedMs,
        ),
        startPositionMs: normalizeMilliseconds(snapshot.startPositionMs),
        positionMs: normalizeMilliseconds(snapshot.positionMs),
        durationMs: normalizeMilliseconds(snapshot.durationMs),
        listenedMs: normalizeMilliseconds(snapshot.listenedMs),
        endedReason: ENDED_REASONS.has(snapshot.endedReason)
          ? snapshot.endedReason
          : 'app_closed',
        reportedMs: 0,
        startedConfirmed: false,
        chain: Promise.resolve(),
      }));
    snapshots.forEach((session) => this.pending.set(session.id, session));

    await Promise.all(
      snapshots.map(async (session) => {
        let operation = 'recover-start';
        try {
          const snapshot = serializable(session);
          await this.api.start(snapshot);
          operation = 'recover-end';
          await this.api.end(snapshot, session.endedReason);
          this.pending.delete(session.id);
        } catch (error) {
          this.onError(error, {
            operation,
            recovered: true,
            session: serializable(session),
          });
        }
      }),
    );
    await this._persistPending();
  }

  handleStatus(status, playbackContext) {
    if (!status?.trackId) return;
    if (status.error) {
      if (this.active?.trackId === status.trackId) {
        this.end('error', status.positionMs, {
          trackId: status.trackId,
          playbackItemId: status.itemId,
        });
      }
      return;
    }

    const changedOwner = Boolean(
      this.active &&
        (this.active.trackId !== status.trackId ||
          (this.active.playbackItemId &&
            status.itemId &&
            this.active.playbackItemId !== status.itemId)),
    );
    if (changedOwner) {
      const previous = this.active;
      this.end('replaced', previous.positionMs, {
        sessionId: previous.id,
      });
    }
    if (!this.active && status.isPlaying === true) {
      this._start(status, playbackContext);
    }
    const session = this.active;
    if (!session || session.trackId !== status.trackId) return;

    const previousPlaying = session.wasPlaying;
    this._sample(session, status, this.now());
    const unreportedMs = session.listenedMs - session.reportedMs;
    if (unreportedMs >= this.checkpointIntervalMs) {
      this._checkpoint(session);
    } else if (
      previousPlaying &&
      status.isPlaying !== true &&
      unreportedMs >= this.pauseCheckpointMinimumMs
    ) {
      this._checkpoint(session);
    } else if (this.now() - session.lastPersistAt >= this.persistIntervalMs) {
      session.lastPersistAt = this.now();
      this._persistPending();
    }
  }

  checkpointNow(force = true) {
    const session = this.active;
    if (!session) return Promise.resolve();
    this._accrue(session, this.now());
    session.lastSampleAt = this.now();
    if (!force && session.listenedMs - session.reportedMs < this.pauseCheckpointMinimumMs) {
      return Promise.resolve();
    }
    this._persistPending();
    return this._checkpoint(session, force);
  }

  end(endedReason, positionMs, owner) {
    const session = this.active;
    if (!session || !sameOwner(session, owner)) return Promise.resolve(false);
    const normalizedReason = ENDED_REASONS.has(endedReason)
      ? endedReason
      : 'error';
    this._accrue(session, this.now());
    session.positionMs = normalizeMilliseconds(positionMs);
    session.wasPlaying = false;
    session.endedReason = normalizedReason;
    this.active = null;

    if (!this.enabled) return Promise.resolve(true);
    this.pending.set(session.id, session);
    this._persistPending();
    const snapshot = serializable(session);
    return this._enqueue(session, async () => {
      await this._ensureStarted(session, snapshot);
      await this.api.end(snapshot, normalizedReason);
      this.pending.delete(session.id);
      await this._persistPending();
      return true;
    }, 'end');
  }

  async flush() {
    await Promise.all(
      [...this.pending.values()].map((session) =>
        Promise.resolve(session.chain).catch(() => undefined),
      ),
    );
    await this.persistChain;
  }

  getSnapshot() {
    return this.active ? serializable(this.active) : null;
  }

  _start(status, playbackContext) {
    const now = this.now();
    const session = {
      id: this.createId(),
      trackId: status.trackId,
      playbackItemId:
        typeof status.itemId === 'string' ? status.itemId : null,
      context: normalizeListeningContext(playbackContext),
      startedAtMs: now,
      startPositionMs: normalizeMilliseconds(status.positionMs),
      positionMs: normalizeMilliseconds(status.positionMs),
      durationMs: normalizeMilliseconds(status.durationMs),
      listenedMs: 0,
      reportedMs: 0,
      endedReason: null,
      wasPlaying: true,
      lastSampleAt: now,
      lastPersistAt: now,
      checkpointQueued: false,
      startedConfirmed: false,
      chain: Promise.resolve(),
    };
    this.active = session;
    this.onStarted(status.trackId);
    if (!this.enabled) return;
    this.pending.set(session.id, session);
    this._persistPending();
    const snapshot = serializable(session);
    this._enqueue(
      session,
      () => this._ensureStarted(session, snapshot),
      'start',
    );
  }

  _sample(session, status, now) {
    this._accrue(session, now);
    session.positionMs = normalizeMilliseconds(status.positionMs);
    session.durationMs = Math.max(
      session.durationMs,
      normalizeMilliseconds(status.durationMs),
    );
    session.wasPlaying = status.isPlaying === true;
    session.lastSampleAt = now;
  }

  _accrue(session, now) {
    if (!session.wasPlaying || !Number.isFinite(session.lastSampleAt)) return;
    const elapsed = Math.max(0, now - session.lastSampleAt);
    session.listenedMs = normalizeMilliseconds(
      session.listenedMs + Math.min(elapsed, this.maxStatusSampleGapMs),
    );
  }

  _checkpoint(session, force = false) {
    if (!this.enabled || session.checkpointQueued) return Promise.resolve();
    if (session.listenedMs <= session.reportedMs) {
      return Promise.resolve();
    }
    session.checkpointQueued = true;
    const snapshot = serializable(session);
    return this._enqueue(session, async () => {
      await this._ensureStarted(session, snapshot);
      await this.api.checkpoint(snapshot);
      session.reportedMs = Math.max(session.reportedMs, snapshot.listenedMs);
      await this._persistPending();
    }, 'checkpoint').finally(() => {
      session.checkpointQueued = false;
    });
  }

  _enqueue(session, task, operationName) {
    const request = Promise.resolve(session.chain)
      .catch(() => undefined)
      .then(task);
    session.chain = request;
    request.catch((error) =>
      this.onError(error, {
        operation: operationName,
        recovered: false,
        session: serializable(session),
      }),
    );
    return request;
  }

  async _ensureStarted(session, snapshot) {
    if (session.startedConfirmed) return;
    await this.api.start(snapshot);
    session.startedConfirmed = true;
  }

  _persistPending() {
    if (!this.enabled) return Promise.resolve();
    const snapshots = [...this.pending.values()].map(serializable);
    this.persistChain = this.persistChain
      .catch(() => undefined)
      .then(() => this.storage.save(snapshots));
    return this.persistChain;
  }
}

function createListeningSessionTracker(options) {
  return new ListeningSessionTracker(options);
}

module.exports = {
  CHECKPOINT_INTERVAL_MS,
  MAX_STATUS_SAMPLE_GAP_MS,
  PAUSE_CHECKPOINT_MINIMUM_MS,
  PERSIST_INTERVAL_MS,
  createListeningSessionTracker,
  normalizeListeningContext,
};
