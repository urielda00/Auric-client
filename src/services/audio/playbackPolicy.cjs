function isCurrentPlaybackEvent(event, currentTrackId, currentItemId) {
  if (!event?.trackId || event.trackId !== currentTrackId) return false;
  return !event.itemId || !currentItemId || event.itemId === currentItemId;
}

function createCompletionHandler({ getCurrentTrackId, next }) {
  return (event) => {
    if (isCurrentPlaybackEvent(event, getCurrentTrackId())) return next();
    return undefined;
  };
}

function takeNextPlayable({ shift, getTrack, isPlayable }) {
  let id = shift();
  while (id) {
    const track = getTrack(id);
    if (track && isPlayable(track)) return track;
    id = shift();
  }
  return null;
}

function normalizeRestoredPosition(positionMs, durationMs) {
  const position = Math.max(0, Number(positionMs) || 0);
  const duration = Math.max(0, Number(durationMs) || 0);
  return duration > 0 ? Math.min(position, duration) : position;
}

module.exports = {
  createCompletionHandler,
  isCurrentPlaybackEvent,
  normalizeRestoredPosition,
  takeNextPlayable,
};
