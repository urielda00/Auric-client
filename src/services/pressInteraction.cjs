const { isTrackPlayable } = require("./trackMapper.cjs");

function canOfferTrackActions(track) {
  return isTrackPlayable(track);
}

function performPlayNextAction({ track, close, enqueue }) {
  if (!canOfferTrackActions(track)) return false;
  close();
  enqueue(track.id, { type: "play_next", label: "Play Next" });
  return true;
}

function createExclusivePressHandlers({ onPress, onLongPress }) {
  let longPressHandled = false;

  return {
    onPressIn() {
      longPressHandled = false;
    },
    onLongPress(event) {
      longPressHandled = true;
      onLongPress?.(event);
    },
    onPress(event) {
      if (longPressHandled) {
        longPressHandled = false;
        return;
      }
      onPress?.(event);
    },
  };
}

function playTrackFromList({ track, tracks, context, index, playTrackFromContext }) {
  if (!canOfferTrackActions(track)) return false;
  const selectedIndex = Number.isInteger(index)
    ? index
    : tracks.findIndex((item) => (typeof item === "string" ? item : item?.id) === track.id);
  if (typeof __DEV__ !== "undefined" && __DEV__) {
    console.debug("[AuricPlayback] track tap", {
      trackId: track.id,
      context: context.type,
      selectedIndex,
      sourceSize: tracks.length,
    });
  }
  return playTrackFromContext(track.id, tracks, context, selectedIndex);
}

module.exports = {
  canOfferTrackActions,
  createExclusivePressHandlers,
  playTrackFromList,
  performPlayNextAction,
};
