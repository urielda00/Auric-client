async function restorePlaybackSnapshot({
  snapshot,
  getTrack,
  cacheTracks,
  hydrateQueue,
  setPlayer,
  getCurrentTrackId,
  audioEngine,
  isPlayable,
  normalizePosition,
  playbackFailureMessage,
  loadAudio = true,
}) {
  const tracks = [
    snapshot.current?.track,
    ...snapshot.upcoming.map((item) => item.track),
    ...snapshot.played.map((item) => item.track),
  ].filter(Boolean);
  if (tracks.length) cacheTracks(tracks);
  hydrateQueue(snapshot.upcoming);
  const playedItems = snapshot.played.map(({ id, trackId, context }) => ({
    id,
    trackId,
    context,
  }));
  const trackId = snapshot.current?.trackId || null;
  const track = snapshot.current?.track || (trackId ? getTrack(trackId) : null);
  if (!trackId || !track || !isPlayable(track)) {
    setPlayer({
      currentTrackId: null,
      currentItemId: null,
      positionMs: 0,
      durationMs: 0,
      isPlaying: false,
      isBuffering: false,
      isLoading: false,
      playbackError: trackId ? playbackFailureMessage() : null,
      playbackContext: { type: "none", label: "" },
      shuffleMode: snapshot.shuffleMode || null,
      playedItems,
      playedStack: playedItems.map((item) => item.trackId),
    });
    return false;
  }
  const positionMs = normalizePosition(snapshot.positionMs, track.durationMs);
  setPlayer({
    currentTrackId: trackId,
    currentItemId: snapshot.current.id,
    positionMs,
    durationMs: track.durationMs || 0,
    isPlaying: false,
    isBuffering: loadAudio,
    isLoading: loadAudio,
    playbackError: null,
    playbackContext: snapshot.current.context,
    shuffleMode: snapshot.shuffleMode || null,
    playedItems,
    playedStack: playedItems.map((item) => item.trackId),
  });
  if (!loadAudio) return true;
  try {
    const nativeRestore = {
      currentItemId: snapshot.current.id,
      context: snapshot.current.context,
      upcoming: snapshot.upcoming.map((item) => ({
        ...item,
        itemId: item.id,
        track: item.track || getTrack(item.trackId),
      })),
    };
    if (audioEngine.restorePaused) {
      await audioEngine.restorePaused(track, {
        ...nativeRestore,
        positionMs,
      });
    } else {
      await audioEngine.load(track, nativeRestore);
      if (getCurrentTrackId() !== trackId) return false;
      await audioEngine.seekTo(positionMs);
    }
    if (getCurrentTrackId() !== trackId) return false;
    setPlayer({ isPlaying: false, isBuffering: false, isLoading: false });
    return true;
  } catch {
    if (getCurrentTrackId() === trackId) {
      setPlayer({
        isPlaying: false,
        isLoading: false,
        isBuffering: false,
        playbackError: playbackFailureMessage(),
      });
    }
    return false;
  }
}

module.exports = { restorePlaybackSnapshot };
