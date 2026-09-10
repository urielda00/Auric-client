const DEFAULT_STATUS = Object.freeze({
  positionMs: 0,
  durationMs: 0,
  isPlaying: false,
  isBuffering: false,
  isLoaded: false,
  error: null,
});

class ExpoAudioEngineCore {
  constructor({ audio, platformOS, createSource }) {
    this.audio = audio;
    this.platformOS = platformOS;
    this.createSource = createSource;
    this.player = null;
    this.subscription = null;
    this.trackId = null;
    this.generation = 0;
    this.endedGeneration = null;
    this.onStatus = null;
    this.onEnded = null;
    this.notificationPermissionRequested = false;
    this.lockScreenMetadata = null;
    this.status = { ...DEFAULT_STATUS };
    this.initialization = audio
      .setAudioModeAsync({
        playsInSilentMode: true,
        shouldPlayInBackground: true,
        interruptionMode: "doNotMix",
        allowsRecording: false,
        shouldRouteThroughEarpiece: false,
      })
      .then(
        () => null,
        (error) => error,
      );
  }

  async load(track) {
    if (!track || track.hasMedia !== true) {
      throw new Error("TRACK_HAS_NO_MEDIA");
    }
    const generation = ++this.generation;
    this._releasePlayer();
    this.trackId = track.id;
    this.endedGeneration = null;
    this.status = {
      ...DEFAULT_STATUS,
      durationMs: Number.isFinite(track.durationMs) ? track.durationMs : 0,
      isBuffering: true,
    };
    this._emitStatus(generation);

    const initializationError = await this.initialization;
    if (initializationError) throw initializationError;
    if (generation !== this.generation) return generation;

    const player = this.audio.createAudioPlayer(this.createSource(track), {
      updateInterval: 250,
      downloadFirst: false,
      keepAudioSessionActive: true,
      preferredForwardBufferDuration: 15,
    });
    this.player = player;
    this.subscription = player.addListener("playbackStatusUpdate", (status) => {
      if (generation !== this.generation || player !== this.player) return;
      this.status = {
        positionMs: Math.max(0, Math.round((status.currentTime || 0) * 1000)),
        durationMs: Math.max(0, Math.round((status.duration || 0) * 1000)),
        isPlaying: status.playing === true,
        isBuffering: status.isBuffering === true,
        isLoaded: status.isLoaded === true,
        error: status.error || null,
      };
      this._emitStatus(generation);
      if (
        status.didJustFinish === true &&
        this.endedGeneration !== generation
      ) {
        this.endedGeneration = generation;
        this.onEnded?.({ trackId: this.trackId, generation });
      }
    });
    this.lockScreenMetadata = {
      title: track.title,
      artist: Array.isArray(track.artists) ? track.artists.join(", ") : "",
      albumTitle: track.album || undefined,
    };
    return generation;
  }

  async play() {
    if (!this.player) throw new Error("NO_AUDIO_LOADED");
    await this._requestNotificationPermissionOnce();
    this.player.setActiveForLockScreen(
      true,
      this.lockScreenMetadata || undefined,
      { showSeekBackward: true, showSeekForward: true, isLiveStream: false },
    );
    this.player.play();
  }

  async pause() {
    this.player?.pause();
  }

  async seekTo(ms) {
    if (!this.player) throw new Error("NO_AUDIO_LOADED");
    const seconds = Math.max(0, ms) / 1000;
    await this.player.seekTo(seconds, 0, 0);
  }

  setOnStatus(fn) {
    this.onStatus = fn;
  }

  setOnEnded(fn) {
    this.onEnded = fn;
  }

  getStatus() {
    return {
      ...this.status,
      trackId: this.trackId,
      generation: this.generation,
    };
  }

  destroy() {
    this.generation += 1;
    this._releasePlayer();
    this.trackId = null;
    this.lockScreenMetadata = null;
    this.onStatus = null;
    this.onEnded = null;
    this.status = { ...DEFAULT_STATUS };
  }

  _emitStatus(generation) {
    this.onStatus?.({ ...this.status, trackId: this.trackId, generation });
  }

  async _requestNotificationPermissionOnce() {
    if (
      this.notificationPermissionRequested ||
      this.platformOS !== "android" ||
      typeof this.audio.requestNotificationPermissionsAsync !== "function"
    ) {
      return;
    }
    this.notificationPermissionRequested = true;
    try {
      await this.audio.requestNotificationPermissionsAsync();
    } catch {
      // Notification denial must not prevent foreground playback.
    }
  }

  _releasePlayer() {
    this.subscription?.remove?.();
    this.subscription = null;
    if (this.player) {
      try {
        this.player.clearLockScreenControls();
        this.player.pause();
        this.player.remove();
      } catch {
        // Native teardown is best effort; generation checks suppress stale events.
      }
    }
    this.player = null;
  }
}

module.exports = { ExpoAudioEngineCore };
