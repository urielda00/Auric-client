function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

/** Map a physical x coordinate to progress. Layout direction is intentionally irrelevant. */
function physicalSeekRatio(x, width) {
  if (!Number.isFinite(x) || !Number.isFinite(width) || width <= 0) {
    return null;
  }
  return clamp(x / width, 0, 1);
}

function seekPositionFromRatio(ratio, durationMs) {
  if (
    !Number.isFinite(ratio) ||
    !Number.isFinite(durationMs) ||
    durationMs <= 0
  ) {
    return null;
  }
  return Math.round(clamp(ratio, 0, 1) * durationMs);
}

/** Bind transport behavior to physical screen sides, never logical start/end. */
function bindPhysicalTransportActions({ previous, next }) {
  return { left: previous, right: next };
}

module.exports = {
  bindPhysicalTransportActions,
  physicalSeekRatio,
  seekPositionFromRatio,
};
