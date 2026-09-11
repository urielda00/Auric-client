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

module.exports = {
  canOfferTrackActions,
  createExclusivePressHandlers,
  performPlayNextAction,
};
