const PLAYED_ROW_HEIGHT = 58;

function resolveEntry(entry, type, tracksById) {
  const track = tracksById[entry.trackId];
  if (!track) return null;
  return {
    id: entry.id,
    trackId: entry.trackId,
    context: entry.context,
    track,
    type,
  };
}

/** Build the queue's read-only playback timeline without changing canonical state. */
function deriveQueueTimeline({
  playedItems = [],
  currentTrackId = null,
  currentItemId = null,
  playbackContext = null,
  queueEntries = [],
  tracksById = {},
}) {
  const played = playedItems
    .map((item) => resolveEntry(item, "played", tracksById))
    .filter(Boolean);
  const currentTrack = currentTrackId ? tracksById[currentTrackId] : null;
  const current = currentTrack
    ? {
        id: currentItemId,
        trackId: currentTrackId,
        context: playbackContext,
        track: currentTrack,
        type: "current",
      }
    : null;
  const upcoming = queueEntries
    .map((item) => resolveEntry(item, "upcoming", tracksById))
    .filter(Boolean);

  return { played, current, upcoming };
}

function getQueueInitialOffset(playedCount) {
  return Math.max(0, playedCount * PLAYED_ROW_HEIGHT);
}

function createQueuePlaybackControls(toggle) {
  return {
    togglePlayback: () => toggle(),
  };
}

module.exports = {
  PLAYED_ROW_HEIGHT,
  createQueuePlaybackControls,
  deriveQueueTimeline,
  getQueueInitialOffset,
};
