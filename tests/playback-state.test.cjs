const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const {
  createPlaybackStateApi,
  mapPlaybackSnapshot,
  snapshotBody,
} = require("../src/services/playbackStateApi.cjs");
const {
  createPlaybackSyncCoordinator,
} = require("../src/services/playbackSyncCoordinator.cjs");
const {
  restorePlaybackSnapshot,
} = require("../src/services/audio/playbackRestore.cjs");
const {
  createCheckpointGate,
} = require("../src/services/audio/checkpointPolicy.cjs");
const {
  createLatestActivationCoordinator,
} = require("../src/services/audio/latestActivationCoordinator.cjs");

const TRACK_DTO = {
  id: "018f0000-0000-7000-8000-000000000001",
  title: "Track",
  artists: ["Artist"],
  version: null,
  album: null,
  release_year: null,
  genre: null,
  duration_ms: 100000,
  has_media: true,
};
const SECOND_DTO = {
  ...TRACK_DTO,
  id: "018f0000-0000-7000-8000-000000000002",
  title: "Second",
};
const CONTEXT = { type: "liked_songs", label: "Liked Songs" };
const ITEM_ID = "028f0000-0000-7000-8000-000000000001";
const CURRENT_ITEM_ID = "028f0000-0000-7000-8000-000000000002";

function dto(overrides = {}) {
  return {
    revision: 4,
    current: { id: CURRENT_ITEM_ID, track: TRACK_DTO, context: CONTEXT },
    position_ms: 12345,
    shuffle_mode: null,
    upcoming: [{ id: ITEM_ID, track: SECOND_DTO, context: CONTEXT }],
    played: [],
    updated_at_ms: 100,
    ...overrides,
  };
}

function localSnapshot(overrides = {}) {
  return {
    revision: 0,
    current: { id: CURRENT_ITEM_ID, trackId: TRACK_DTO.id, context: CONTEXT },
    positionMs: 1000,
    shuffleMode: null,
    upcoming: [],
    played: [],
    updatedAtMs: 1,
    ...overrides,
  };
}

function memoryStorage(initial = null) {
  let value = initial;
  return {
    async load() {
      return value;
    },
    async save(next) {
      value = next;
    },
    value() {
      return value;
    },
  };
}

function activationHarness() {
  const coordinator = createLatestActivationCoordinator();
  let nativeGeneration = 0;
  const effects = {
    persisted: [],
    history: [],
    ended: [],
    commits: [],
  };
  let state = {
    currentTrackId: "committed",
    currentItemId: "item-committed",
    positionMs: 4200,
    playbackContext: CONTEXT,
    playedStack: [],
    playedItems: [],
    playbackError: null,
  };

  function isNativeCurrent(generation) {
    return generation === nativeGeneration;
  }

  return {
    effects,
    get state() {
      return state;
    },
    begin(trackId) {
      const { token, baseline } = coordinator.begin(() => ({ ...state }));
      const generation = ++nativeGeneration;
      coordinator.attachGeneration(token, generation);
      state = {
        ...state,
        currentTrackId: trackId,
        currentItemId: `item-${trackId}`,
        positionMs: 0,
        playbackError: null,
      };
      return { trackId, token, baseline };
    },
    complete(operation) {
      if (!coordinator.isCurrent(operation.token, isNativeCurrent)) {
        return false;
      }
      if (
        operation.baseline.currentTrackId &&
        operation.baseline.currentTrackId !== operation.trackId
      ) {
        effects.ended.push(operation.baseline.currentTrackId);
        effects.history.push(operation.baseline.currentTrackId);
      }
      state = {
        ...state,
        currentTrackId: operation.trackId,
        currentItemId: `item-${operation.trackId}`,
        playbackError: null,
      };
      effects.commits.push(operation.trackId);
      effects.persisted.push(operation.trackId);
      return coordinator.commit(operation.token, isNativeCurrent);
    },
    fail(operation) {
      if (!coordinator.fail(operation.token, isNativeCurrent)) return false;
      state = {
        ...state,
        currentTrackId: operation.trackId,
        currentItemId: `item-${operation.trackId}`,
        playbackError: "Unable to play",
      };
      return true;
    },
    canPersist() {
      return !coordinator.hasUncommittedSelection();
    },
  };
}

function projectionHarness() {
  const coordinator = createLatestActivationCoordinator();
  let generation = 0;
  let currentTrackId = null;
  let logicalQueue = [];
  const nativeProjections = [];

  const isNativeCurrent = (value) => value === generation;
  const projectLatest = () => {
    nativeProjections.push([currentTrackId, ...logicalQueue]);
  };

  return {
    coordinator,
    nativeProjections,
    begin(trackId) {
      const { token } = coordinator.begin(() => ({}));
      generation += 1;
      coordinator.attachGeneration(token, generation);
      currentTrackId = trackId;
      logicalQueue = [];
      return token;
    },
    refill(...trackIds) {
      logicalQueue = [...new Set([...logicalQueue, ...trackIds])];
      if (coordinator.requestProjection()) projectLatest();
    },
    requestProjection() {
      if (coordinator.requestProjection()) projectLatest();
    },
    commit(token) {
      const result = coordinator.commitAndTakeProjectionRequest(
        token,
        isNativeCurrent,
      );
      if (result.projectionRequested) projectLatest();
      return result.committed;
    },
    reorder(trackIds) {
      logicalQueue = [...trackIds];
      if (coordinator.requestProjection()) projectLatest();
    },
  };
}

test("pending direct-play refill collapses to one latest native projection after commit", () => {
  const harness = projectionHarness();
  const token = harness.begin("A");

  harness.refill("next", "later", "next");
  harness.requestProjection();
  assert.deepEqual(harness.nativeProjections, []);

  assert.equal(harness.commit(token), true);
  assert.deepEqual(harness.nativeProjections, [["A", "next", "later"]]);
});

test("rapid direct selection lets only the latest activation flush projection", () => {
  const harness = projectionHarness();
  const tokenA = harness.begin("A");
  harness.refill("A-next");
  const tokenB = harness.begin("B");
  harness.refill("B-next", "B-later");

  assert.equal(harness.commit(tokenA), false);
  assert.deepEqual(harness.nativeProjections, []);
  assert.equal(harness.commit(tokenB), true);
  assert.deepEqual(harness.nativeProjections, [["B", "B-next", "B-later"]]);
});

test("post-activation reorder and background requests project normally without loops", () => {
  const harness = projectionHarness();
  const token = harness.begin("current");
  harness.refill("one", "two");
  harness.commit(token);

  harness.reorder(["two", "one"]);
  harness.requestProjection();
  assert.deepEqual(harness.nativeProjections, [
    ["current", "one", "two"],
    ["current", "two", "one"],
    ["current", "two", "one"],
  ]);
});

test("background persistence reconciles known local successors before flushing state", () => {
  const source = readFileSync(
    join(process.cwd(), "src/stores/usePlayerStore.js"),
    "utf8",
  );
  const persistNow = source.slice(
    source.indexOf("async persistNow()"),
    source.indexOf("ensureQueueDepth(options)"),
  );

  assert.ok(
    persistNow.indexOf("waitForPending()") <
      persistNow.indexOf("await syncNativeProjection(get)"),
  );
  assert.ok(
    persistNow.indexOf("await syncNativeProjection(get)") <
      persistNow.indexOf('persistPlaybackState(get(), "replace")'),
  );
  assert.doesNotMatch(persistNow, /ensureQueueDepth|recommendationService/);
  assert.doesNotMatch(source.slice(0, source.indexOf("async function activate")), /QueueScreen/);
});

test("successful activation always verifies the latest native projection", () => {
  const source = readFileSync(
    join(process.cwd(), "src/stores/usePlayerStore.js"),
    "utf8",
  );
  const commitStart = source.indexOf(
    "const committed = activations.commitAndTakeProjectionRequest",
  );
  const activationCommit = source.slice(
    commitStart,
    source.indexOf("listeningTracker.handleStatus", commitStart),
  );
  assert.match(activationCommit, /if \(!committed\.committed\) return false;/);
  assert.match(activationCommit, /await syncNativeProjection\(get\);/);
  assert.doesNotMatch(activationCommit, /if \(committed\.projectionRequested\)/);
});

test("Remote Previous delegates to the same live-position semantics as foreground", () => {
  const source = readFileSync(
    join(process.cwd(), "src/stores/usePlayerStore.js"),
    "utf8",
  );
  assert.match(
    source,
    /setOnRemotePrevious\?\.\(\(\) =>[\s\S]*get\(\)\.previous\(\{/,
  );
  const previousStart = source.indexOf("async previous(");
  const previous = source.slice(
    previousStart,
    source.indexOf("async next(", previousStart),
  );
  assert.match(previous, /const nativeStatus = audioEngine\.getStatus\(\)/);
  assert.match(previous, /selectPreviousAction\(\{/);
  assert.match(previous, /hasHistory: playedStack\.length > 0/);
  assert.match(previous, /await get\(\)\.seek\(0\)/);
  assert.match(previous, /playedStack: playedStack\.slice\(0, -1\)/);
  assert.match(previous, /playedItems: playedItems\.slice\(0, -1\)/);
  assert.doesNotMatch(previous, /preferHistory/);
  assert.doesNotMatch(previous, /currentTrackId:\s*null/);
  assert.doesNotMatch(previous, /notifyExplicitPlaybackSelection/);
});

test("DEV playback snapshots cover direct refill, projection, and queued activation", () => {
  const source = readFileSync(
    join(process.cwd(), "src/stores/usePlayerStore.js"),
    "utf8",
  );
  const engine = readFileSync(
    join(
      process.cwd(),
      "src/services/audio/TrackPlayerAudioEngineCore.cjs",
    ),
    "utf8",
  );
  for (const reason of [
    "direct activation committed",
    "direct refill completed",
    "post-refill projection completed",
    "post-refill projection settled",
    "playQueued activation committed",
  ]) {
    assert.match(source, new RegExp(reason));
  }
  assert.match(source, /typeof __DEV__ !== "undefined" && __DEV__/);
  assert.match(source, /logicalCurrentItemId/);
  assert.match(source, /logicalUpcomingItemIds/);
  assert.match(engine, /this\.player\.getQueue\?\.\(\)/);
  assert.match(engine, /this\.player\.getActiveMediaItem\?\.\(\)/);
  assert.match(engine, /this\.player\.getActiveMediaItemIndex\?\.\(\)/);
  assert.match(source, /nativeIsPlaying/);
});

test("tap A, then B before A is ready commits only B", () => {
  const harness = activationHarness();
  const a = harness.begin("A");
  const b = harness.begin("B");

  assert.equal(harness.complete(a), false);
  assert.equal(harness.complete(b), true);
  assert.deepEqual(harness.effects.commits, ["B"]);
});

test("rapid A, B, C activation commits only C", () => {
  const harness = activationHarness();
  const a = harness.begin("A");
  const b = harness.begin("B");
  const c = harness.begin("C");

  assert.equal(harness.complete(a), false);
  assert.equal(harness.complete(b), false);
  assert.equal(harness.complete(c), true);
  assert.deepEqual(harness.effects.commits, ["C"]);
});

test("stale completion cannot overwrite the latest selected track", () => {
  const harness = activationHarness();
  const a = harness.begin("A");
  const c = harness.begin("C");

  harness.complete(c);
  harness.complete(a);
  assert.equal(harness.state.currentTrackId, "C");
});

test("stale failure cannot roll back the latest selected track", () => {
  const harness = activationHarness();
  const a = harness.begin("A");
  harness.begin("C");

  assert.equal(harness.fail(a), false);
  assert.equal(harness.state.currentTrackId, "C");
  assert.equal(harness.state.playbackError, null);
});

test("stale activation cannot persist or append played history", () => {
  const harness = activationHarness();
  const a = harness.begin("A");
  const c = harness.begin("C");

  harness.complete(a);
  harness.complete(c);
  assert.deepEqual(harness.effects.persisted, ["C"]);
  assert.deepEqual(harness.effects.history, ["committed"]);
});

test("stale activation cannot end the listening session owned by the committed track", () => {
  const harness = activationHarness();
  const a = harness.begin("A");
  const c = harness.begin("C");

  harness.complete(a);
  assert.deepEqual(harness.effects.ended, []);
  harness.complete(c);
  assert.deepEqual(harness.effects.ended, ["committed"]);
});

test("latest failed selection stays selected, coherent, and retryable", () => {
  const harness = activationHarness();
  const failed = harness.begin("A");

  assert.equal(harness.fail(failed), true);
  assert.equal(harness.state.currentTrackId, "A");
  assert.equal(harness.state.currentItemId, "item-A");
  assert.equal(harness.state.playbackError, "Unable to play");
  assert.equal(harness.canPersist(), false);

  const retry = harness.begin("A");
  assert.equal(harness.complete(retry), true);
  assert.equal(harness.state.currentTrackId, "A");
  assert.equal(harness.state.playbackError, null);
  assert.equal(harness.canPersist(), true);
  assert.deepEqual(harness.effects.history, ["committed"]);
  assert.deepEqual(harness.effects.ended, ["committed"]);
});

test("maps one atomic server snapshot with queue Track metadata and context", () => {
  const snapshot = mapPlaybackSnapshot(dto());
  assert.equal(snapshot.current.trackId, TRACK_DTO.id);
  assert.equal(snapshot.current.id, CURRENT_ITEM_ID);
  assert.equal(snapshot.current.track.title, "Track");
  assert.equal(snapshot.upcoming[0].trackId, SECOND_DTO.id);
  assert.deepEqual(snapshot.upcoming[0].context, CONTEXT);
  assert.equal(snapshot.positionMs, 12345);
});

test("snapshot API sends revisions, stable queue IDs, and checkpoint Track guards", async () => {
  const calls = [];
  const client = {
    async put(path, body) {
      calls.push(["put", path, body]);
      return { data: dto({ revision: 5 }) };
    },
    async patch(path, body) {
      calls.push(["patch", path, body]);
      return { data: dto({ revision: 6 }) };
    },
  };
  const api = createPlaybackStateApi(client);
  const snapshot = mapPlaybackSnapshot(dto());
  await api.replace(snapshot, 4);
  await api.checkpoint({ currentTrackId: TRACK_DTO.id, positionMs: 2222 }, 5);
  assert.equal(calls[0][2].expected_revision, 4);
  assert.equal(calls[0][2].upcoming[0].id, ITEM_ID);
  assert.equal(calls[1][2].current_track_id, TRACK_DTO.id);
  assert.equal(calls[1][2].position_ms, 2222);
  assert.deepEqual(snapshotBody(snapshot, 4).current.context, CONTEXT);
});

test("hydrates from the server and keeps the local snapshot only as fallback", async () => {
  const storage = memoryStorage(localSnapshot());
  const remote = mapPlaybackSnapshot(dto());
  const coordinator = createPlaybackSyncCoordinator({
    enabled: true,
    storage,
    api: { get: async () => remote },
  });
  const result = await coordinator.hydrate();
  assert.equal(result.source, "server");
  assert.equal(result.snapshot.revision, 4);
  assert.equal(storage.value().positionMs, 12345);

  const offline = createPlaybackSyncCoordinator({
    enabled: true,
    storage: memoryStorage(localSnapshot({ positionMs: 7777 })),
    api: {
      get: async () => {
        throw new Error("offline");
      },
    },
  });
  const fallback = await offline.hydrate();
  assert.equal(fallback.source, "offline");
  assert.equal(fallback.snapshot.positionMs, 7777);
});

test("local playback hydration completes while remote reconciliation is unresolved", async () => {
  const never = new Promise(() => {});
  const coordinator = createPlaybackSyncCoordinator({
    enabled: true,
    storage: memoryStorage(localSnapshot({ positionMs: 2468 })),
    api: { get: () => never },
  });
  const local = await coordinator.hydrateLocal();
  assert.equal(local.source, "local");
  assert.equal(local.snapshot.positionMs, 2468);
});

test("bootstraps an untouched server once from durable legacy local state", async () => {
  const local = localSnapshot({ positionMs: 4321 });
  const writes = [];
  const coordinator = createPlaybackSyncCoordinator({
    enabled: true,
    storage: memoryStorage(local),
    api: {
      async get() {
        return {
          revision: 0,
          current: null,
          positionMs: 0,
          shuffleMode: null,
          upcoming: [],
          played: [],
          updatedAtMs: 0,
        };
      },
      async replace(snapshot, revision) {
        writes.push({ snapshot, revision });
        return { ...snapshot, revision: 1 };
      },
    },
  });
  const result = await coordinator.hydrate();
  assert.equal(result.source, "local-bootstrap");
  assert.equal(result.snapshot.positionMs, 4321);
  assert.equal(writes[0].revision, 0);
});

test("never applies hydration that finishes after a local Track change", async () => {
  let resolveRemote;
  const remotePromise = new Promise((resolve) => {
    resolveRemote = resolve;
  });
  const coordinator = createPlaybackSyncCoordinator({
    enabled: true,
    storage: memoryStorage(localSnapshot()),
    api: { get: () => remotePromise },
  });
  const hydration = coordinator.hydrate();
  coordinator.markLocalChange();
  resolveRemote(mapPlaybackSnapshot(dto()));
  const result = await hydration;
  assert.equal(result.source, "local-stale-hydration");
  assert.equal(result.snapshot.positionMs, 1000);
});

test("serializes Play Next, reorder, remove, Next, Previous, and completion snapshots", async () => {
  const writes = [];
  const storage = memoryStorage(localSnapshot());
  const api = {
    async get() {
      return { ...localSnapshot(), revision: writes.length };
    },
    async replace(snapshot, revision) {
      writes.push({ snapshot, revision });
      return { ...snapshot, revision: revision + 1 };
    },
  };
  const coordinator = createPlaybackSyncCoordinator({
    enabled: true,
    storage,
    api,
  });
  await coordinator.hydrate();
  const playNext = localSnapshot({
    upcoming: [
      {
        id: ITEM_ID,
        trackId: SECOND_DTO.id,
        context: { type: "play_next", label: "Play Next" },
      },
    ],
  });
  const reorder = { ...playNext, upcoming: [...playNext.upcoming].reverse() };
  const remove = { ...playNext, upcoming: [] };
  const next = localSnapshot({
    current: { trackId: SECOND_DTO.id, context: CONTEXT },
    played: [{ id: ITEM_ID, trackId: TRACK_DTO.id, context: CONTEXT }],
  });
  const previous = localSnapshot({
    current: {
      trackId: TRACK_DTO.id,
      context: { type: "direct", label: "Previous" },
    },
    upcoming: [{ id: ITEM_ID, trackId: SECOND_DTO.id, context: CONTEXT }],
  });
  await Promise.all([
    coordinator.replace(playNext),
    coordinator.replace(reorder),
    coordinator.replace(remove),
    coordinator.replace(next),
    coordinator.replace(previous),
  ]);
  assert.deepEqual(
    writes.map((write) => write.revision),
    [0, 1, 2, 3, 4],
  );
  assert.equal(writes.at(-1).snapshot.current.trackId, TRACK_DTO.id);
  assert.equal(writes.at(-1).snapshot.current.context.label, "Previous");
});

test("refetches on revision conflict and does not overwrite newer server state", async () => {
  const newer = { ...localSnapshot(), revision: 9, positionMs: 9000 };
  const applied = [];
  const coordinator = createPlaybackSyncCoordinator({
    enabled: true,
    storage: memoryStorage(localSnapshot()),
    api: {
      get: async () => newer,
      replace: async () => {
        const error = new Error("conflict");
        error.code = "PLAYBACK_STATE_CONFLICT";
        throw error;
      },
    },
  });
  await coordinator.hydrate();
  coordinator.setConflictHandler((snapshot) => applied.push(snapshot));
  await assert.rejects(coordinator.replace(localSnapshot({ positionMs: 2 })));
  assert.equal(applied[0].revision, 9);
  assert.equal(applied[0].positionMs, 9000);
});

test("a stale old-Track checkpoint cannot overwrite a newly selected Track", async () => {
  let server = localSnapshot();
  const storage = memoryStorage(server);
  const conflict = () => {
    const error = new Error("conflict");
    error.code = "PLAYBACK_STATE_CONFLICT";
    return error;
  };
  const coordinator = createPlaybackSyncCoordinator({
    enabled: true,
    storage,
    api: {
      async get() {
        return server;
      },
      async replace(snapshot, revision) {
        if (revision !== server.revision) throw conflict();
        server = { ...snapshot, revision: revision + 1 };
        return server;
      },
      async checkpoint(checkpoint, revision) {
        if (
          revision !== server.revision ||
          checkpoint.currentTrackId !== server.current.trackId
        ) {
          throw conflict();
        }
        server = {
          ...server,
          revision: revision + 1,
          positionMs: checkpoint.positionMs,
        };
        return server;
      },
    },
  });
  await coordinator.hydrate();
  const replacement = localSnapshot({
    current: {
      id: "038f0000-0000-7000-8000-000000000001",
      trackId: SECOND_DTO.id,
      context: { type: "search", label: "Search" },
    },
    positionMs: 0,
  });
  await coordinator.replace(replacement);
  await assert.rejects(
    coordinator.checkpoint(localSnapshot({ positionMs: 90000 })),
  );
  assert.equal(server.current.trackId, SECOND_DTO.id);
  assert.equal(storage.value().current.trackId, SECOND_DTO.id);
});

test("mock mode remains local and never requires an API", async () => {
  const storage = memoryStorage(localSnapshot());
  const coordinator = createPlaybackSyncCoordinator({
    enabled: false,
    storage,
    api: null,
  });
  assert.equal((await coordinator.hydrate()).source, "local");
  await coordinator.replace(localSnapshot({ positionMs: 5555 }));
  assert.equal(storage.value().positionMs, 5555);
});

test("background history persistence is durable before replace resolves", async () => {
  let releaseSave;
  let saved = false;
  const coordinator = createPlaybackSyncCoordinator({
    api: null,
    enabled: false,
    storage: {
      load: async () => null,
      save: async () => {
        await new Promise((resolve) => {
          releaseSave = resolve;
        });
        saved = true;
      },
    },
  });
  const replacement = coordinator.replace(
    localSnapshot({
      played: [{ id: ITEM_ID, trackId: SECOND_DTO.id, context: CONTEXT }],
    }),
  );
  let settled = false;
  void replacement.then(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(saved, false);

  releaseSave();
  await replacement;
  assert.equal(saved, true);
  assert.equal(settled, true);
});

test("background playback session hydrates played history before dispatch", () => {
  const source = readFileSync(
    join(process.cwd(), "src/services/audio/playbackSession.js"),
    "utf8",
  );
  const handler = source.slice(source.indexOf("async function ensureBackgroundPlaybackState"));
  assert.ok(
    handler.indexOf("useLibraryStore.getState().hydrate()") <
      handler.indexOf("useQueueStore.getState().hydrate()"),
  );
  assert.ok(
    handler.indexOf("useQueueStore.getState().hydrate()") <
      handler.indexOf("await usePlayerStore.getState().hydrate"),
  );
  assert.ok(
    handler.indexOf("await ensureBackgroundPlaybackState()") <
      handler.indexOf("await audioEngine.handleNativeEvent?.(event)"),
  );
});

test("restores current, queue, played stack, and saved position paused", async () => {
  const snapshot = mapPlaybackSnapshot(
    dto({
      played: [
        {
          id: "038f0000-0000-7000-8000-000000000001",
          track: SECOND_DTO,
          context: { type: "search", label: "Search" },
        },
      ],
    }),
  );
  const calls = [];
  let state = {};
  const restored = await restorePlaybackSnapshot({
    snapshot,
    getTrack: () => null,
    cacheTracks: (tracks) => calls.push(["cache", tracks.length]),
    hydrateQueue: (items) =>
      calls.push(["queue", items.map((item) => item.id)]),
    setPlayer: (next) => {
      state = { ...state, ...next };
    },
    getCurrentTrackId: () => state.currentTrackId,
    audioEngine: {
      async load(track) {
        calls.push(["load", track.id]);
      },
      async seekTo(position) {
        calls.push(["seek", position]);
      },
      async play() {
        calls.push(["play"]);
      },
    },
    isPlayable: (track) => track.hasMedia,
    normalizePosition: (position, duration) => Math.min(position, duration),
    playbackFailureMessage: () => "failed",
  });
  assert.equal(restored, true);
  assert.equal(state.isPlaying, false);
  assert.equal(state.positionMs, 12345);
  assert.deepEqual(state.playedStack, [SECOND_DTO.id]);
  assert.deepEqual(calls.find((call) => call[0] === "queue")[1], [ITEM_ID]);
  assert.equal(
    calls.some((call) => call[0] === "play"),
    false,
  );
});

test("restores playback UI without loading network audio", async () => {
  const snapshot = mapPlaybackSnapshot(dto());
  let state = {};
  let loads = 0;
  const restored = await restorePlaybackSnapshot({
    snapshot,
    getTrack: () => null,
    cacheTracks: () => {},
    hydrateQueue: () => {},
    setPlayer: (next) => {
      state = { ...state, ...next };
    },
    getCurrentTrackId: () => state.currentTrackId,
    audioEngine: {
      async load() {
        loads += 1;
      },
      async seekTo() {},
    },
    isPlayable: (track) => track.hasMedia,
    normalizePosition: (position, duration) => Math.min(position, duration),
    playbackFailureMessage: () => "failed",
    loadAudio: false,
  });
  assert.equal(restored, true);
  assert.equal(loads, 0);
  assert.equal(state.currentTrackId, TRACK_DTO.id);
  assert.equal(state.positionMs, 12345);
  assert.equal(state.isLoading, false);
});

test("checkpoint cadence is bounded while explicit seek/background flushes can force it", () => {
  const gate = createCheckpointGate(15000);
  assert.equal(gate.shouldCheckpoint({ nowMs: 1000, isPlaying: true }), false);
  assert.equal(gate.shouldCheckpoint({ nowMs: 15000, isPlaying: true }), true);
  assert.equal(gate.shouldCheckpoint({ nowMs: 16000, isPlaying: true }), false);
  assert.equal(
    gate.shouldCheckpoint({ nowMs: 16001, isPlaying: false, force: true }),
    true,
  );
});
