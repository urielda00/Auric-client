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
    this.timer = null;
  }

  load(track) {
    if (!track || track.hasMedia !== true)
      throw new Error("TRACK_HAS_NO_MEDIA");
    this._stopTimer();
    this.positionMs = 0;
    this.durationMs = track?.durationMs || 0;
    this.isPlaying = false;
    this.trackId = track.id;
    this._emitStatus();
  }

  play() {
    if (this.isPlaying || this.durationMs <= 0) return;
    this.isPlaying = true;
    this._startTimer();
    this._emitStatus();
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

  setOnStatus(fn) {
    this.onStatus = fn;
  }

  setOnEnded(fn) {
    this.onEnded = fn;
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
      generation: 0,
    };
  }

  destroy() {
    this._stopTimer();
    this.onStatus = null;
    this.onEnded = null;
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
        this.onEnded?.({ trackId: this.trackId, generation: 0 });
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
