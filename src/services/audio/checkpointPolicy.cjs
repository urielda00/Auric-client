function createCheckpointGate(intervalMs) {
  let lastAt = 0;
  return {
    shouldCheckpoint({ nowMs, isPlaying, force = false }) {
      if (force) {
        lastAt = nowMs;
        return true;
      }
      if (!isPlaying || nowMs - lastAt < intervalMs) return false;
      lastAt = nowMs;
      return true;
    },
    reset(nowMs = 0) {
      lastAt = nowMs;
    },
  };
}

module.exports = { createCheckpointGate };
