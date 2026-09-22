// iOS uses this window when auto preloading is eligible. On Android the
// installed @rntp/player 5.7 treats any positive value as a switch for
// ExoPlayer's immediate-next-item preload. It cannot guarantee two buffered
// successors, and this setting does not limit the native queue projection.
const NATIVE_PRELOAD_COUNT = 2;

function buildNativeProjection({
  current,
  upcoming = [],
  getTrack,
  isPlayable,
  successorCount = Number.MAX_SAFE_INTEGER,
}) {
  if (!current?.track || !isPlayable(current.track)) return [];
  const projection = [{ ...current, isCurrent: true }];
  for (const entry of upcoming) {
    if (projection.length > successorCount) break;
    const track = entry.track || getTrack?.(entry.trackId);
    if (!track || !isPlayable(track)) continue;
    projection.push({
      track,
      itemId: entry.itemId || entry.id,
      context: entry.context,
      isCurrent: false,
    });
  }
  return projection;
}

function projectionIds(projection) {
  return projection.map((item) => item.itemId);
}

function sameProjection(left, right) {
  const leftIds = projectionIds(left);
  const rightIds = projectionIds(right);
  return (
    leftIds.length === rightIds.length &&
    leftIds.every((id, index) => id === rightIds[index])
  );
}

function classifyPlaybackError(error) {
  const code = typeof error?.code === "string" ? error.code : "unknown";
  const message = typeof error?.message === "string" ? error.message : "";
  const authentication =
    /(?:^|\D)(?:401|403)(?:\D|$)|unauthori[sz]ed|forbidden/i.test(message);
  if (authentication) {
    return {
      code: "AUTHENTICATION_REQUIRED",
      kind: "authentication",
      retryable: false,
    };
  }
  return {
    code: code === "network" ? "NETWORK_ERROR" : "PLAYBACK_ERROR",
    kind: code,
    retryable: code === "network",
  };
}

function createTransitionGate() {
  let active = null;
  return {
    run(operation) {
      if (active) return active;
      const request = Promise.resolve().then(operation);
      active = request.finally(() => {
        if (active === request || active === wrapped) active = null;
      });
      const wrapped = active;
      return wrapped;
    },
    isPending() {
      return Boolean(active);
    },
  };
}

function createIdempotentTransitionTracker(limit = 32) {
  const seen = [];
  const ids = new Set();
  return {
    accept(itemId) {
      if (!itemId || ids.has(itemId)) return false;
      ids.add(itemId);
      seen.push(itemId);
      while (seen.length > limit) ids.delete(seen.shift());
      return true;
    },
    reset() {
      seen.length = 0;
      ids.clear();
    },
  };
}

function consumeNativeTransition({ currentItemId, event, queueEntries }) {
  const targetIndex = queueEntries.findIndex(
    (entry) => entry.id === event?.itemId && entry.trackId === event?.trackId,
  );
  const advancedEntries =
    targetIndex >= 0 ? queueEntries.slice(0, targetIndex + 1) : [];
  const expectedPath = [
    currentItemId,
    ...advancedEntries.map((entry) => entry.id),
  ];
  const nativePath = Array.isArray(event?.nativeItemIds)
    ? event.nativeItemIds
    : [];
  const nativePathMatches =
    nativePath.length === expectedPath.length &&
    nativePath.every((id, index) => id === expectedPath[index]);
  const accepted = Boolean(
    targetIndex >= 0 &&
      (nativePathMatches ||
        (targetIndex === 0 && event?.previousItemId === currentItemId)),
  );
  return accepted
    ? {
        accepted: true,
        entry: advancedEntries.at(-1),
        advancedEntries,
        remaining: queueEntries.slice(targetIndex + 1),
      }
    : {
        accepted: false,
        entry: null,
        advancedEntries: [],
        remaining: queueEntries,
      };
}

function appendAdvancedHistory({
  current,
  advancedEntries,
  playedStack = [],
  playedItems = [],
  limit = 50,
}) {
  const completed = [current, ...advancedEntries.slice(0, -1)].filter(
    (item) => item?.trackId,
  );
  return {
    playedStack: [
      ...playedStack,
      ...completed.map((item) => item.trackId),
    ].slice(-limit),
    playedItems: [...playedItems, ...completed].slice(-limit),
  };
}

function buildPreviousQueue(current, queueEntries) {
  if (!current?.id) return queueEntries;
  return [
    current,
    ...queueEntries.filter((item) => item.id !== current.id),
  ];
}

function selectPreviousAction({
  positionMs,
  hasHistory,
  restartThresholdMs = 4000,
}) {
  return Number(positionMs) > restartThresholdMs || !hasHistory
    ? "restart-current"
    : "previous-track";
}

module.exports = {
  NATIVE_PRELOAD_COUNT,
  appendAdvancedHistory,
  buildPreviousQueue,
  buildNativeProjection,
  classifyPlaybackError,
  consumeNativeTransition,
  createIdempotentTransitionTracker,
  createTransitionGate,
  projectionIds,
  selectPreviousAction,
  sameProjection,
};
