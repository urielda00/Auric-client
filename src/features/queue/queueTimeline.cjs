const PLAYED_ROW_HEIGHT = 58;

function resolveEntry(entry, type, index, tracksById) {
  const track = tracksById[entry.trackId];
  if (!track) return null;
  return {
    id: entry.id,
    trackId: entry.trackId,
    context: entry.context,
    track,
    type,
    queueIndex: type === "upcoming" ? index : null,
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
    .map((item, index) => resolveEntry(item, "played", index, tracksById))
    .filter(Boolean);
  const currentTrack = currentTrackId ? tracksById[currentTrackId] : null;
  const current = currentTrack
    ? {
        id: currentItemId,
        trackId: currentTrackId,
        context: playbackContext,
        track: currentTrack,
        type: "current",
        queueIndex: null,
      }
    : null;
  const upcoming = queueEntries
    .map((item, index) =>
      resolveEntry(item, "upcoming", index, tracksById),
    )
    .filter(Boolean);

  return { played, current, upcoming };
}

function getQueueInitialOffset(playedCount) {
  return Math.max(0, playedCount * PLAYED_ROW_HEIGHT);
}

function getUpcomingMutationIndex(upcoming, renderedIndex) {
  return upcoming[renderedIndex]?.queueIndex ?? -1;
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
  getUpcomingMutationIndex,
};
