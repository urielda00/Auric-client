import { AudioEngine } from './AudioEngine';

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
    this.onProgress = null;
    this.onEnded = null;
    this.timer = null;
  }

  load(track) {
    this._stopTimer();
    this.positionMs = 0;
    this.durationMs = track?.durationMs || 0;
    this.isPlaying = false;
  }

  play() {
    if (this.isPlaying || this.durationMs <= 0) return;
    this.isPlaying = true;
    this._startTimer();
  }

  pause() {
    this.isPlaying = false;
    this._stopTimer();
  }

  seekTo(ms) {
    this.positionMs = Math.max(0, Math.min(this.durationMs, Math.round(ms)));
    this.onProgress?.(this.positionMs);
  }

  setOnProgress(fn) {
    this.onProgress = fn;
  }

  setOnEnded(fn) {
    this.onEnded = fn;
  }

  getStatus() {
    return { positionMs: this.positionMs, durationMs: this.durationMs, isPlaying: this.isPlaying };
  }

  destroy() {
    this._stopTimer();
    this.onProgress = null;
    this.onEnded = null;
  }

  _startTimer() {
    this._stopTimer();
    this.timer = setInterval(() => {
      this.positionMs += TICK_MS;
      if (this.positionMs >= this.durationMs) {
        this.positionMs = this.durationMs;
        this.onProgress?.(this.positionMs);
        this.isPlaying = false;
        this._stopTimer();
        this.onEnded?.();
        return;
      }
      this.onProgress?.(this.positionMs);
    }, TICK_MS);
  }

  _stopTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export default MockAudioEngine;
