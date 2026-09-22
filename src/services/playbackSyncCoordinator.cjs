function stripTracks(snapshot) {
  const stripItem = ({ id, trackId, context }) => ({ id, trackId, context });
  return {
    revision: snapshot.revision ?? 0,
    current: snapshot.current
      ? {
          id: snapshot.current.id,
          trackId: snapshot.current.trackId,
          context: snapshot.current.context,
        }
      : null,
    positionMs: snapshot.current ? snapshot.positionMs : 0,
    shuffleMode: snapshot.shuffleMode ?? null,
    upcoming: (snapshot.upcoming || []).map(stripItem),
    played: (snapshot.played || []).map(stripItem),
    updatedAtMs: snapshot.updatedAtMs ?? Date.now(),
  };
}

function createPlaybackSyncCoordinator({ api, storage, enabled, trace = () => {} }) {
  let revision = 0;
  let generation = 0;
  let selectionGeneration = 0;
  let activeItemId = null;
  let chain = Promise.resolve();
  let localChain = null;

  const save = (snapshot) => {
    const local = stripTracks(snapshot);
    const write = localChain
      ? localChain.catch(() => undefined).then(() => storage.save(local))
      : Promise.resolve(storage.save(local));
    const tracked = write.finally(() => {
      if (localChain === tracked) localChain = null;
    });
    localChain = tracked;
    return tracked;
  };

  const reconcileConflict = async () => {
    const remote = await api.get();
    // A conflict GET supplies a new revision, never a playback selection.
    // Applying the returned snapshot here can roll back a newer native track.
    revision = remote.revision;
    trace("conflict GET metadata", { revision, remoteItemId: remote.current?.id ?? null });
    return remote;
  };

  const queueWrite = (kind, operationGeneration, ownerSelectionGeneration, ownerItemId, operation, recover) => {
    const ownsSelection = () => ownerSelectionGeneration === selectionGeneration &&
      ownerItemId === activeItemId;
    const details = () => ({ kind, operationGeneration, ownerSelectionGeneration,
      currentSelectionGeneration: selectionGeneration, ownerItemId, activeItemId, revision });
    trace("write queued", details());
    const result = chain
      .catch(() => undefined)
      .then(async () => {
        if (!ownsSelection()) {
          trace("stale write skipped", details());
          return null;
        }
        try {
          trace("write dispatched", details());
          const remote = await operation(revision);
          revision = remote.revision;
          trace("write accepted", details());
          if (operationGeneration === generation && ownsSelection()) {
            await save(remote);
          }
          return remote;
        } catch (error) {
          trace("write rejected", { ...details(), code: error?.code, status: error?.status, validation: error?.details });
          if (error?.code === "PLAYBACK_STATE_CONFLICT") {
            const latest = await reconcileConflict();
            if (!ownsSelection()) {
              trace("stale conflict ignored", details());
              return null;
            }
            trace("current selection retry", details());
            let recovered;
            try {
              recovered = await recover(latest, revision);
            } catch (retryError) {
              trace("current selection retry rejected", {
                ...details(), code: retryError?.code, status: retryError?.status,
                validation: retryError?.details,
              });
              throw retryError;
            }
            revision = recovered.revision;
            trace("current selection recovered", details());
            if (operationGeneration === generation && ownsSelection()) {
              await save(recovered);
            }
            return recovered;
          }
          throw error;
        }
      });
    chain = result;
    return result;
  };

  const hydrateLocal = async () => {
    const hydrationGeneration = generation;
    const local = await storage.load();
    if (hydrationGeneration === generation) {
      revision = local?.revision ?? 0;
      activeItemId = local?.current?.id ?? null;
    }
    return { snapshot: local, source: "local", generation: hydrationGeneration };
  };

  const reconcile = async (localSnapshot, startedAtGeneration = generation) => {
    const local = localSnapshot ?? (await storage.load());
    if (startedAtGeneration !== generation) {
      return { snapshot: local, source: "local-stale-hydration" };
    }
    revision = local?.revision ?? 0;
    if (!enabled) return { snapshot: local, source: "local" };
    try {
      const remote = await api.get();
      if (startedAtGeneration !== generation) {
        return { snapshot: local, source: "local-stale-hydration" };
      }
      revision = remote.revision;
      activeItemId = remote.current?.id ?? null;
      const remoteIsPristine =
        remote.revision === 0 &&
        remote.current === null &&
        remote.upcoming.length === 0 &&
        remote.played.length === 0;
      const localHasState =
        local?.current != null ||
        (local?.upcoming?.length ?? 0) > 0 ||
        (local?.played?.length ?? 0) > 0;
      if (remoteIsPristine && localHasState) {
        const seeded = await api.replace(local, 0);
        revision = seeded.revision;
        if (startedAtGeneration !== generation) {
          return { snapshot: local, source: "local-stale-hydration" };
        }
        await save(seeded);
        if (startedAtGeneration !== generation) {
          return { snapshot: local, source: "local-stale-hydration" };
        }
        activeItemId = seeded.current?.id ?? null;
        return { snapshot: seeded, source: "local-bootstrap" };
      }
      await save(remote);
      if (startedAtGeneration !== generation) {
        return { snapshot: local, source: "local-stale-hydration" };
      }
      return { snapshot: remote, source: "server" };
    } catch {
      if (startedAtGeneration === generation) {
        activeItemId = local?.current?.id ?? null;
      }
      return { snapshot: local, source: "offline" };
    }
  };

  return {
    get enabled() {
      return enabled;
    },
    get revision() {
      return revision;
    },
    get selectionGeneration() {
      return selectionGeneration;
    },
    isGenerationCurrent(value) {
      return value === generation;
    },
    markLocalChange() {
      generation += 1;
      selectionGeneration += 1;
      trace("selection generation advanced", { selectionGeneration, activeItemId, revision });
      return generation;
    },
    async stageLocal(snapshot) {
      generation += 1;
      selectionGeneration += 1;
      const local = { ...stripTracks(snapshot), revision };
      activeItemId = local.current?.id ?? null;
      await save(local);
      return local;
    },
    hydrateLocal,
    reconcile,
    async hydrate() {
      const local = await hydrateLocal();
      return reconcile(local.snapshot, local.generation);
    },
    replace(snapshot) {
      const operationGeneration = ++generation;
      const ownerSelectionGeneration = selectionGeneration;
      const local = { ...stripTracks(snapshot), revision };
      const ownerItemId = local.current?.id ?? null;
      activeItemId = ownerItemId;
      trace("local replacement selected", { selectionGeneration, activeItemId, revision,
        trackId: local.current?.trackId ?? null });
      const localWrite = save(local);
      if (!enabled) return localWrite.then(() => local);
      const remoteWrite = queueWrite(
        "replace",
        operationGeneration,
        ownerSelectionGeneration,
        ownerItemId,
        (expectedRevision) => api.replace(local, expectedRevision),
        (_remote, expectedRevision) => api.replace(local, expectedRevision),
      );
      return Promise.all([localWrite, remoteWrite]).then(([, remote]) => remote);
    },
    checkpoint(snapshot) {
      const local = { ...stripTracks(snapshot), revision };
      if (activeItemId !== null && local.current?.id !== activeItemId) {
        trace("stale checkpoint skipped", { selectionGeneration, activeItemId,
          checkpointItemId: local.current?.id ?? null, revision });
        return Promise.resolve(null);
      }
      const operationGeneration = ++generation;
      const ownerSelectionGeneration = selectionGeneration;
      const ownerItemId = local.current?.id ?? null;
      const localWrite = save(local);
      if (!enabled || !local.current) return localWrite.then(() => local);
      const checkpointBody = {
        currentTrackId: local.current.trackId,
        positionMs: local.positionMs,
      };
      const remoteWrite = queueWrite(
        "checkpoint",
        operationGeneration,
        ownerSelectionGeneration,
        ownerItemId,
        (expectedRevision) => api.checkpoint(checkpointBody, expectedRevision),
        (remote, expectedRevision) => remote.current?.id === local.current.id
          ? api.checkpoint(checkpointBody, expectedRevision)
          : api.replace(local, expectedRevision),
      );
      return Promise.all([localWrite, remoteWrite]).then(([, remote]) => remote);
    },
    async flush() {
      try {
        await chain;
      } catch {
        // Local state is already durable; reconnect will reconcile deliberately.
      }
    },
  };
}

module.exports = { createPlaybackSyncCoordinator, stripTracks };
