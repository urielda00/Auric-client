const DEFAULT_QUEUE_TARGET = 30;
const DEFAULT_REFILL_THRESHOLD = 8;
const DEFAULT_EMERGENCY_THRESHOLD = 3;
const DEFAULT_RECENT_LIMIT = 20;
const DEFAULT_FAILURE_COOLDOWN_MS = 5000;

function uniqueTrackIds(values) {
  return [...new Set(values.filter(Boolean))];
}

function moveTrackToFront(entries, nextEntry) {
  return [
    nextEntry,
    ...entries.filter((item) => item.trackId !== nextEntry.trackId),
  ];
}

function appendUniqueEntries(entries, additions) {
  const seen = new Set(entries.map((item) => item.trackId));
  const appended = [];
  for (const item of additions) {
    if (!item?.trackId || seen.has(item.trackId)) continue;
    seen.add(item.trackId);
    appended.push(item);
  }
  return [...entries, ...appended];
}

function buildRefillExclusions({ currentTrackId, queueEntries, recentTrackIds }, recentLimit) {
  return uniqueTrackIds([
    currentTrackId,
    ...queueEntries.map((item) => item.trackId),
    ...recentTrackIds.slice(-recentLimit),
  ]);
}

function filterRecommendationBatch(tracks, excludedIds, capacity, isPlayable) {
  const seen = new Set(excludedIds);
  const result = [];
  for (const track of tracks) {
    if (!isPlayable(track) || seen.has(track.id)) continue;
    seen.add(track.id);
    result.push(track);
    if (result.length >= capacity) break;
  }
  return result;
}

function startDirectPlayback({ resetQueue, activate, refill }) {
  resetQueue();
  return Promise.resolve(activate()).then((activated) => {
    if (activated !== false) {
      Promise.resolve(refill()).catch(() => {});
    }
    return activated;
  });
}

async function takeNextWithEmergency({ takeNext, emergencyRefill }) {
  const queued = takeNext();
  if (queued) return queued;
  await emergencyRefill();
  return takeNext();
}

function createQueueRefillCoordinator({
  getQueueEntries,
  getCurrentTrackId,
  getRecentTrackIds,
  getMode,
  requestSmart,
  requestRandom,
  cacheTracks,
  appendTracks,
  isPlayable,
  now = Date.now,
  target = DEFAULT_QUEUE_TARGET,
  refillThreshold = DEFAULT_REFILL_THRESHOLD,
  emergencyThreshold = DEFAULT_EMERGENCY_THRESHOLD,
  recentLimit = DEFAULT_RECENT_LIMIT,
  failureCooldownMs = DEFAULT_FAILURE_COOLDOWN_MS,
}) {
  let inFlight = null;
  let generation = 0;
  let rerunRequested = false;
  let lastFailureAt = -Infinity;
  let lastEmergencyAt = -Infinity;

  async function performRefill({ emergency = false, force = false } = {}) {
    if (!getCurrentTrackId()) return false;
    const queueEntries = getQueueEntries();
    const threshold = emergency ? emergencyThreshold : refillThreshold;
    if (!force && queueEntries.length > threshold) return false;
    if (inFlight) return inFlight;
    if (emergency) {
      if (now() - lastEmergencyAt < failureCooldownMs) return false;
      lastEmergencyAt = now();
    } else if (now() - lastFailureAt < failureCooldownMs) {
      return false;
    }

    const requestGeneration = generation;
    const exclusions = buildRefillExclusions(
      {
        currentTrackId: getCurrentTrackId(),
        queueEntries,
        recentTrackIds: getRecentTrackIds(),
      },
      recentLimit,
    );
    const capacity = Math.max(0, target - queueEntries.length);
    if (!capacity) return false;
    const mode = getMode() === "random" ? "random" : "smart";

    inFlight = (async () => {
      try {
        const tracks = await (mode === "random"
          ? requestRandom(capacity, { excludeTrackIds: exclusions })
          : requestSmart(capacity, { excludeTrackIds: exclusions }));
        if (requestGeneration !== generation) return false;
        const liveEntries = getQueueEntries();
        const liveExclusions = buildRefillExclusions(
          {
            currentTrackId: getCurrentTrackId(),
            queueEntries: liveEntries,
            recentTrackIds: getRecentTrackIds(),
          },
          recentLimit,
        );
        const batch = filterRecommendationBatch(
          tracks,
          liveExclusions,
          Math.max(0, target - liveEntries.length),
          isPlayable,
        );
        if (!batch.length) {
          lastFailureAt = now();
          return false;
        }
        cacheTracks(batch);
        appendTracks(batch, mode);
        return true;
      } catch {
        lastFailureAt = now();
        return false;
      } finally {
        inFlight = null;
        if (rerunRequested) {
          rerunRequested = false;
          Promise.resolve().then(() => performRefill()).catch(() => {});
        }
      }
    })();

    return inFlight;
  }

  return {
    refill: performRefill,
    invalidate({ refillAfterPending = false } = {}) {
      generation += 1;
      rerunRequested = Boolean(inFlight && refillAfterPending);
    },
    isPending() {
      return Boolean(inFlight);
    },
    constants: {
      target,
      refillThreshold,
      emergencyThreshold,
      recentLimit,
      failureCooldownMs,
    },
  };
}

module.exports = {
  DEFAULT_EMERGENCY_THRESHOLD,
  DEFAULT_FAILURE_COOLDOWN_MS,
  DEFAULT_QUEUE_TARGET,
  DEFAULT_RECENT_LIMIT,
  DEFAULT_REFILL_THRESHOLD,
  appendUniqueEntries,
  buildRefillExclusions,
  createQueueRefillCoordinator,
  filterRecommendationBatch,
  moveTrackToFront,
  startDirectPlayback,
  takeNextWithEmergency,
};
