const assert = require("node:assert/strict");
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
