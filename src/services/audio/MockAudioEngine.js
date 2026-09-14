import { AudioEngine } from "./AudioEngine";

const TICK_MS = 250;

/**
 * Simulated playback engine for the frontend-mock phase. Drives a plain interval instead
 * of decoding real audio — no network, no files. Implements the same shape `ExpoAudioEngine`
 * will later implement for real M4A streaming.
 */
export class MockAudioEngine extends AudioEngine {
  constructor() {
    super();
    this.positionMs = 0;
    this.durationMs = 0;
    this.isPlaying = false;
    this.onStatus = null;
    this.onEnded = null;
    this.onTrackChanged = null;
    this.onRemoteNext = null;
    this.onRemotePrevious = null;
    this.projection = [];
    this.timer = null;
    this.generation = 0;
  }

  load(track, options = {}) {
    if (!track || track.hasMedia !== true)
      throw new Error("TRACK_HAS_NO_MEDIA");
    const generation = Number.isInteger(options.activationGeneration)
      ? options.activationGeneration
      : this._beginGeneration();
    if (!this.isGenerationCurrent(generation)) {
      throw new Error("STALE_ACTIVATION");
    }
    this._stopTimer();
    this.positionMs = 0;
    this.durationMs = track?.durationMs || 0;
    this.isPlaying = false;
    this.trackId = track.id;
    this.itemId = options.currentItemId || track.id;
    this.projection = [
      {
        track,
        itemId: this.itemId,
        context: options.context || null,
      },
      ...(options.upcoming || []).slice(0, 3),
    ];
    this._emitStatus();
    return generation;
  }

  beginActivation() {
    const generation = this._beginGeneration();
    this.pause();
    return generation;
  }

  cancelActivation() {
    const generation = this._beginGeneration();
    this.pause();
    return generation;
  }

  isGenerationCurrent(generation) {
    return generation === this.generation;
  }

  play(generation) {
    if (
      Number.isInteger(generation) &&
      !this.isGenerationCurrent(generation)
    ) {
      throw new Error("STALE_ACTIVATION");
    }
    if (this.isPlaying || this.durationMs <= 0) return;
    this.isPlaying = true;
    this._startTimer();
    this._emitStatus();
  }

  waitUntilReady() {
    return Promise.resolve(true);
  }

  pause() {
    this.isPlaying = false;
    this._stopTimer();
    this._emitStatus();
  }

  seekTo(ms) {
    this.positionMs = Math.max(0, Math.min(this.durationMs, Math.round(ms)));
    this._emitStatus();
  }

  next(reason = "skipped_next") {
    if (this.projection.length < 2) return Promise.resolve(false);
    const previousTrackId = this.trackId;
    const previousItemId = this.itemId;
    const [, next, ...rest] = this.projection;
    this.projection = [next, ...rest];
    this.trackId = next.track.id;
    this.itemId = next.itemId || next.id;
    this.positionMs = 0;
    this.durationMs = next.track.durationMs || 0;
    this.onTrackChanged?.({
      trackId: this.trackId,
      itemId: this.itemId,
      context: next.context || null,
      previousTrackId,
      previousItemId,
      reason,
      generation: this.generation,
    });
    this._emitStatus();
    return Promise.resolve(true);
  }

  syncQueue(current, upcoming = []) {
    if (!current?.track || current.itemId !== this.itemId) return false;
    this.projection = [current, ...upcoming.slice(0, 3)];
    return true;
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
    return {
      positionMs: this.positionMs,
      durationMs: this.durationMs,
      isPlaying: this.isPlaying,
      isBuffering: false,
      isLoaded: this.durationMs > 0,
      error: null,
      trackId: this.trackId,
      itemId: this.itemId,
      generation: this.generation,
    };
  }

  destroy() {
    this._stopTimer();
    this.onStatus = null;
    this.onEnded = null;
    this.onTrackChanged = null;
    this.onRemoteNext = null;
    this.onRemotePrevious = null;
  }

  _beginGeneration() {
    this.generation += 1;
    return this.generation;
  }

  _startTimer() {
    this._stopTimer();
    this.timer = setInterval(() => {
      this.positionMs += TICK_MS;
      if (this.positionMs >= this.durationMs) {
        this.positionMs = this.durationMs;
        this.isPlaying = false;
        this._stopTimer();
        this._emitStatus();
        if (this.projection.length > 1) {
          const previousTrackId = this.trackId;
          const previousItemId = this.itemId;
          const [, next, ...rest] = this.projection;
          this.projection = [next, ...rest];
          this.trackId = next.track.id;
          this.itemId = next.itemId || next.id;
          this.positionMs = 0;
          this.durationMs = next.track.durationMs || 0;
          this.isPlaying = true;
          this.onTrackChanged?.({
            trackId: this.trackId,
            itemId: this.itemId,
            context: next.context || null,
            previousTrackId,
            previousItemId,
            reason: "completed",
            generation: this.generation,
          });
          this._startTimer();
          this._emitStatus();
          return;
        }
        this.onEnded?.({
          trackId: this.trackId,
          generation: this.generation,
        });
        return;
      }
      this._emitStatus();
    }, TICK_MS);
  }

  _stopTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  _emitStatus() {
    this.onStatus?.(this.getStatus());
  }
}

export default MockAudioEngine;
