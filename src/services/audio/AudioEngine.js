/**
 * AudioEngine — the playback boundary usePlayerStore talks to.
 *
 * MockAudioEngine keeps isolated UI work deterministic. ExpoAudioEngine implements the
 * same contract with the installed expo-audio native player for server-backed playback.
 *
 * Every engine must implement:
 *   load(track)              -> prepare a track; resets position to 0, stays paused
 *   play()                   -> resume/start playback
 *   pause()                  -> pause playback
 *   seekTo(ms)                -> jump to a position
 *   setOnStatus(fn)           -> actual loading/buffering/playback status
 *   setOnEnded(fn)            -> fn() fires once when the loaded track completes
 *   getStatus()               -> { positionMs, durationMs, isPlaying }
 *   destroy()                 -> release timers/native resources
 */

export class AudioEngine {
  load(/* track */) {
    throw new Error("AudioEngine.load not implemented");
  }
  play() {
    throw new Error("AudioEngine.play not implemented");
  }
  pause() {
    throw new Error("AudioEngine.pause not implemented");
  }
  seekTo(/* ms */) {
    throw new Error("AudioEngine.seekTo not implemented");
  }
  setOnStatus(/* fn */) {}
  setOnEnded(/* fn */) {}
  getStatus() {
    return { positionMs: 0, durationMs: 0, isPlaying: false };
  }
  destroy() {}
}

export default AudioEngine;
