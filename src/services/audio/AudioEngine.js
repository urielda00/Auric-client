/**
 * AudioEngine — the playback boundary usePlayerStore talks to.
 *
 * This phase ships `MockAudioEngine`, which simulates progress with a timer and never
 * touches the network or a real decoder. A future `ExpoAudioEngine` (built on `expo-audio`'s
 * `createAudioPlayer`, with `setAudioModeAsync({ shouldPlayInBackground: true, ... })` and
 * `setActiveForLockScreen()` for lock-screen/Bluetooth controls) implements the exact same
 * shape below and can be swapped in `./index.js` without any screen or store changing.
 *
 * Every engine must implement:
 *   load(track)              -> prepare a track; resets position to 0, stays paused
 *   play()                   -> resume/start playback
 *   pause()                  -> pause playback
 *   seekTo(ms)                -> jump to a position
 *   setOnProgress(fn)         -> fn(positionMs) fires while playing
 *   setOnEnded(fn)            -> fn() fires once when the loaded track completes
 *   getStatus()               -> { positionMs, durationMs, isPlaying }
 *   destroy()                 -> release timers/native resources
 */

export class AudioEngine {
  load(/* track */) {
    throw new Error('AudioEngine.load not implemented');
  }
  play() {
    throw new Error('AudioEngine.play not implemented');
  }
  pause() {
    throw new Error('AudioEngine.pause not implemented');
  }
  seekTo(/* ms */) {
    throw new Error('AudioEngine.seekTo not implemented');
  }
  setOnProgress(/* fn */) {}
  setOnEnded(/* fn */) {}
  getStatus() {
    return { positionMs: 0, durationMs: 0, isPlaying: false };
  }
  destroy() {}
}

export default AudioEngine;
