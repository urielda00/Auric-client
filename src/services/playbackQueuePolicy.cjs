const DEFAULT_QUEUE_TARGET = 30;
const DEFAULT_REFILL_THRESHOLD = 3;
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

function buildContextSelection(trackId, trackIds, isPlayable, index) {
  const ids = (Array.isArray(trackIds) ? trackIds : []).map((item) =>
    typeof item === "string" ? item : item?.id || item?.trackId,
  );
  const selectedIndex = Number.isInteger(index) ? index : ids.indexOf(trackId);
  if (
    selectedIndex < 0 ||
    ids[selectedIndex] !== trackId ||
    !isPlayable(trackId)
  ) return null;
  return {
    previous: ids.slice(0, selectedIndex).filter(isPlayable),
    upcoming: ids.slice(selectedIndex + 1).filter(isPlayable),
  };
}

function commitAfterActivation({ activate, commit }) {
  return Promise.resolve(activate()).then((activated) => {
    if (activated !== false) {
      commit();
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

async function runExplicitNext({
  hasLogicalSuccessor,
  reconcile,
  advance,
  emergencyRefill,
  pauseAtExhaustion,
  isCurrent = () => true,
}) {
  if (!isCurrent()) return false;
  let hasSuccessor = hasLogicalSuccessor();
  if (hasSuccessor && !(await reconcile())) return false;
  if (!isCurrent()) return false;

  let advanced = hasSuccessor ? await advance() : false;
  if (!advanced && !hasSuccessor) {
    await emergencyRefill();
    if (!isCurrent()) return false;
    hasSuccessor = hasLogicalSuccessor();
    if (hasSuccessor && (await reconcile())) {
      if (!isCurrent()) return false;
      advanced = await advance();
    }
  }
  if (advanced) return true;
  if (!isCurrent()) return false;
  if (hasLogicalSuccessor()) return false;
  await pauseAtExhaustion();
  return false;
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
  trace = () => {},
  now = Date.now,
  target = DEFAULT_QUEUE_TARGET,
  refillThreshold = DEFAULT_REFILL_THRESHOLD,
  emergencyThreshold = DEFAULT_EMERGENCY_THRESHOLD,
  recentLimit = DEFAULT_RECENT_LIMIT,
  failureCooldownMs = DEFAULT_FAILURE_COOLDOWN_MS,
}) {
  let inFlight = null;
  let inFlightGeneration = null;
  let queuedRerun = null;
  let generation = 0;
  let rerunRequested = false;
  let rerunOptions = null;
  let lastFailureAt = -Infinity;
  let lastEmergencyAt = -Infinity;

  async function performRefill({ emergency = false, force = false } = {}) {
    if (!getCurrentTrackId()) return false;
    const queueEntries = getQueueEntries();
    const threshold = emergency ? emergencyThreshold : refillThreshold;
    if (!force && queueEntries.length > threshold) return false;
    trace("refill trigger", { upcomingCount: queueEntries.length, threshold, force, emergency });
    if (inFlight) {
      if (inFlightGeneration !== generation) {
        rerunRequested = true;
        if (force || emergency) {
          rerunOptions = {
            force: force || rerunOptions?.force || false,
            emergency: emergency || rerunOptions?.emergency || false,
          };
        }
        return inFlight.then(() => queuedRerun || false);
      }
      return inFlight;
    }
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
    trace("refill requested", { count: capacity, upcomingCount: queueEntries.length });
    const explicitMode = getMode();
    const mode = explicitMode === "random"
      ? "random"
      : explicitMode === "smart" ? "smart" : "continuation";

    inFlightGeneration = requestGeneration;
    inFlight = (async () => {
      try {
        const tracks = await (mode === "random"
          ? requestRandom(capacity, { excludeTrackIds: exclusions })
          : requestSmart(capacity, { excludeTrackIds: exclusions }));
        trace("recommendation result", { count: tracks.length, requestedCount: capacity });
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
        trace("queue after refill", { queueSize: getQueueEntries().length, appendedCount: batch.length });
        lastFailureAt = -Infinity;
        return true;
      } catch {
        if (requestGeneration === generation) lastFailureAt = now();
        return false;
      } finally {
        inFlight = null;
        inFlightGeneration = null;
        if (rerunRequested) {
          rerunRequested = false;
          const rerunGeneration = generation;
          const options = rerunOptions || {};
          rerunOptions = null;
          const rerun = Promise.resolve()
            .then(() =>
              rerunGeneration === generation ? performRefill(options) : false,
            )
            .catch(() => false)
            .finally(() => {
              if (queuedRerun === rerun) queuedRerun = null;
            });
          queuedRerun = rerun;
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
      rerunOptions = null;
    },
    isPending() {
      return Boolean(inFlight);
    },
    async waitForPending() {
      let waited = false;
      while (inFlight || queuedRerun) {
        waited = true;
        await (inFlight || queuedRerun);
      }
      return waited;
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
  buildContextSelection,
  commitAfterActivation,
  createQueueRefillCoordinator,
  filterRecommendationBatch,
  moveTrackToFront,
  runExplicitNext,
  takeNextWithEmergency,
};
