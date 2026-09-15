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

function createPlaybackSyncCoordinator({ api, storage, enabled }) {
  let revision = 0;
  let generation = 0;
  let chain = Promise.resolve();
  let conflictHandler = null;

  const save = async (snapshot) => {
    await storage.save(stripTracks(snapshot));
  };

  const reconcileConflict = async (operationGeneration) => {
    const remote = await api.get();
    revision = remote.revision;
    if (operationGeneration === generation) {
      await save(remote);
      await conflictHandler?.(remote);
    }
    return remote;
  };

  const queueWrite = (operationGeneration, operation) => {
    const result = chain
      .catch(() => undefined)
      .then(async () => {
        try {
          const remote = await operation(revision);
          revision = remote.revision;
          if (operationGeneration === generation) await save(remote);
          return remote;
        } catch (error) {
          if (error?.code === "PLAYBACK_STATE_CONFLICT") {
            await reconcileConflict(operationGeneration);
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
    revision = local?.revision ?? 0;
    return { snapshot: local, source: "local", generation: hydrationGeneration };
  };

  const reconcile = async (localSnapshot, startedAtGeneration = generation) => {
    const local = localSnapshot ?? (await storage.load());
    revision = local?.revision ?? 0;
    if (!enabled) return { snapshot: local, source: "local" };
    try {
      const remote = await api.get();
      if (startedAtGeneration !== generation) {
        return { snapshot: local, source: "local-stale-hydration" };
      }
      revision = remote.revision;
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
        return { snapshot: seeded, source: "local-bootstrap" };
      }
      await save(remote);
      return { snapshot: remote, source: "server" };
    } catch {
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
    setConflictHandler(handler) {
      conflictHandler = handler;
    },
    markLocalChange() {
      generation += 1;
      return generation;
    },
    hydrateLocal,
    reconcile,
    async hydrate() {
      const local = await hydrateLocal();
      return reconcile(local.snapshot, local.generation);
    },
    replace(snapshot) {
      const operationGeneration = ++generation;
      const local = { ...stripTracks(snapshot), revision };
      const localWrite = save(local);
      if (!enabled) return localWrite.then(() => local);
      const remoteWrite = queueWrite(operationGeneration, (expectedRevision) =>
        api.replace(local, expectedRevision),
      );
      return Promise.all([localWrite, remoteWrite]).then(([, remote]) => remote);
    },
    checkpoint(snapshot) {
      const operationGeneration = ++generation;
      const local = { ...stripTracks(snapshot), revision };
      const localWrite = save(local);
      if (!enabled || !local.current) return localWrite.then(() => local);
      const remoteWrite = queueWrite(operationGeneration, (expectedRevision) =>
        api.checkpoint(
          {
            currentTrackId: local.current.trackId,
            positionMs: local.positionMs,
          },
          expectedRevision,
        ),
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
