/**
 * AudioEngine — the playback boundary usePlayerStore talks to.
 *
 * MockAudioEngine keeps isolated UI work deterministic. TrackPlayerAudioEngine implements
 * the same contract with a small native playback queue for server-backed playback.
 *
 * Every engine must implement:
 *   beginActivation()       -> reserve/cancel previous activation generation
 *   load(track, options)     -> prepare current + bounded successors, stays paused
 *   play()                   -> resume/start playback
 *   pause()                  -> pause playback
 *   seekTo(ms)                -> jump to a position
 *   next()                   -> request one native queue advancement and play it
 *   syncQueue(current, next) -> patch prepared successors without interrupting current
 *   setOnStatus(fn)           -> actual loading/buffering/playback status
 *   setOnTrackChanged(fn)     -> native-owned advancement accepted by the player
 *   setOnRemoteNext(fn)       -> serialized notification/headset Next action
 *   setOnEnded(fn)            -> fn() fires when the bounded native queue is exhausted
 *   getStatus()               -> { positionMs, durationMs, isPlaying }
 *   getNativePlaybackSnapshot() -> live active item/index/queue/play state
 *   destroy()                 -> release timers/native resources
 */

export class AudioEngine {
  beginActivation() {
    throw new Error("AudioEngine.beginActivation not implemented");
  }
  cancelActivation() {}
  isGenerationCurrent(/* generation */) {
    return true;
  }
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
  next() {
    throw new Error("AudioEngine.next not implemented");
  }
  syncQueue(/* current, upcoming */) {
    return false;
  }
  setOnStatus(/* fn */) {}
  setOnTrackChanged(/* fn */) {}
  setOnRemoteNext(/* fn */) {}
  setOnRemotePrevious(/* fn */) {}
  setOnEnded(/* fn */) {}
  getStatus() {
    return { positionMs: 0, durationMs: 0, isPlaying: false };
  }
  getNativePlaybackSnapshot() {
    const status = this.getStatus();
    return {
      nativeActiveMediaId: status.itemId || null,
      nativeActiveIndex: status.itemId ? 0 : null,
      nativeQueueMediaIds: status.itemId ? [status.itemId] : [],
      nativeIsPlaying: status.isPlaying === true,
    };
  }
  destroy() {}
}

export default AudioEngine;
