function clampIndex(index, length) {
  if (!Number.isFinite(index) || length <= 0) return -1;
  return Math.max(0, Math.min(length - 1, Math.round(index)));
}

const {
  moveEntryRelative,
} = require("../../services/queueEntryPolicy.cjs");

/** JS-side drag session. It retains stable IDs and always clears on finish/cancel. */
function createQueueDragCoordinator({ getEntryIds, onCommit }) {
  let active = null;

  return {
    begin(entryId, renderedEntryIds) {
      const snapshot = [...renderedEntryIds];
      if (
        !snapshot.includes(entryId) ||
        !getEntryIds().includes(entryId)
      ) {
        active = null;
        return false;
      }
      active = { entryId, snapshot };
      return true;
    },

    finish(targetRenderedIndex) {
      const session = active;
      try {
        if (!session) return false;
        const currentIds = getEntryIds();
        if (!currentIds.includes(session.entryId)) return false;

        const startIndex = session.snapshot.indexOf(session.entryId);
        const targetIndex = clampIndex(
          targetRenderedIndex,
          session.snapshot.length,
        );
        if (startIndex < 0 || targetIndex < 0 || startIndex === targetIndex) {
          return false;
        }

        const targetEntryId = session.snapshot[targetIndex];
        if (!currentIds.includes(targetEntryId)) return false;
        const placement = targetIndex > startIndex ? "after" : "before";
        return onCommit(session.entryId, targetEntryId, placement) !== false;
      } finally {
        active = null;
      }
    },

    cancel() {
      const hadActiveDrag = active !== null;
      active = null;
      return hadActiveDrag;
    },

    getActiveEntryId() {
      return active?.entryId ?? null;
    },
  };
}

module.exports = {
  createQueueDragCoordinator,
  moveEntryRelative,
};
