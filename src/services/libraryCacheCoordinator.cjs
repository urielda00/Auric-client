function asTrackArray(value) {
  if (Array.isArray(value)) return value;
  return Array.isArray(value?.tracks) ? value.tracks : [];
}

function createLibraryCacheCoordinator({
  loadCache,
  saveCache,
  loadRemote,
  apply,
  now = Date.now,
}) {
  let cacheHydration = null;
  let refreshInFlight = null;
  let generation = 0;

  const hydrateCache = () => {
    if (!cacheHydration) {
      const hydrationGeneration = generation;
      cacheHydration = Promise.resolve(loadCache()).then((cached) => {
        const tracks = asTrackArray(cached);
        if (hydrationGeneration === generation && tracks.length > 0) {
          apply(tracks);
        }
        return tracks;
      });
    }
    return cacheHydration;
  };

  const refresh = () => {
    if (refreshInFlight) return refreshInFlight;
    const refreshGeneration = generation;
    const request = Promise.resolve(loadRemote()).then(async (tracks) => {
      if (refreshGeneration !== generation) {
        return { tracks, applied: false };
      }
      apply(tracks);
      await saveCache({ version: 1, updatedAtMs: now(), tracks });
      return { tracks, applied: true };
    });
    const shared = request.finally(() => {
      if (refreshInFlight === shared) refreshInFlight = null;
    });
    refreshInFlight = shared;
    return shared;
  };

  return {
    hydrateCache,
    refresh,
    markLocalChange() {
      generation += 1;
    },
  };
}

module.exports = { asTrackArray, createLibraryCacheCoordinator };
