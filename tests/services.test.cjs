const assert = require("node:assert/strict");
const test = require("node:test");

const { ApiError, createApiClient } = require("../src/services/apiClient.cjs");
const { createAddMusicApi, mapImportJob } = require("../src/services/addMusicApi.cjs");
const {
  createLatestSearchRunner,
} = require("../src/services/latestSearch.cjs");
const {
  isTrackPlayable,
  mapTrackDto,
} = require("../src/services/trackMapper.cjs");
const {
  createTrackStreamSource,
} = require("../src/services/audio/streamSource.cjs");
const {
  selectAudioEngine,
} = require("../src/services/audio/engineSelection.cjs");
const {
  ExpoAudioEngineCore,
} = require("../src/services/audio/ExpoAudioEngineCore.cjs");
const {
  createCompletionHandler,
  isCurrentPlaybackEvent,
  normalizeRestoredPosition,
  takeNextPlayable,
} = require("../src/services/audio/playbackPolicy.cjs");

const DTO = {
  id: "018f0000-0000-7000-8000-000000000001",
  title: "Track",
  artists: ["First", "Second"],
  version: null,
  album: "Album",
  release_year: 2024,
  genre: "Pop",
  duration_ms: 123000,
  has_media: false,
};

test("maps the server Track DTO and preserves metadata-only state", () => {
  const track = mapTrackDto(DTO);
  assert.deepEqual(track.artists, ["First", "Second"]);
  assert.equal(track.releaseYear, 2024);
  assert.equal(track.durationMs, 123000);
  assert.equal(track.hasMedia, false);
  assert.equal(isTrackPlayable(track), false);
});

test("API client parses successful envelopes", async () => {
  const client = createApiClient({
    baseUrl: "http://auric.test",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: DTO, meta: { nextCursor: null } }),
    }),
  });
  const response = await client.get("/api/v1/tracks/example");
  assert.equal(response.data.title, "Track");
});

test("API client sends JSON command bodies", async () => {
  let request;
  const client = createApiClient({
    baseUrl: "http://auric.test",
    fetchImpl: async (_url, options) => {
      request = options;
      return { ok: true, status: 202, json: async () => ({ data: { id: "job" } }) };
    },
  });
  await client.post("/api/v1/imports", { title: "Track" });
  assert.equal(request.method, "POST");
  assert.equal(request.headers["Content-Type"], "application/json");
  assert.equal(request.body, JSON.stringify({ title: "Track" }));
});

test("Add Music API polls through ready and keeps only the safe job DTO", async () => {
  const jobs = [
    {
      id: "job-1", status: "queued", created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z", track_id: null,
      failure_code: null, failure_message: null, can_retry: false,
      request_snapshot_json: "must not leak",
    },
    {
      id: "job-1", status: "ready", created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:01.000Z", track_id: "track-1",
      failure_code: null, failure_message: null, can_retry: false,
    },
  ];
  const seen = [];
  const api = createAddMusicApi({
    post: async () => ({ data: jobs[0] }),
    get: async () => ({ data: jobs[1] }),
  }, { pollIntervalMs: 0 });
  const result = await api.submit({ title: "Track" }, (job) => seen.push(job.status));
  assert.deepEqual(seen, ["queued", "ready"]);
  assert.equal(result.trackId, "track-1");
  assert.equal(Object.hasOwn(result, "request_snapshot_json"), false);
});

test("Add Music job DTO rejects raw or malformed server state", () => {
  assert.throws(() => mapImportJob({ id: "job", status: "ready" }), /Invalid import job response/);
});

test("API client preserves canonical server errors", async () => {
  const client = createApiClient({
    baseUrl: "http://auric.test",
    fetchImpl: async () => ({
      ok: false,
      status: 422,
      json: async () => ({
        error: {
          code: "VALIDATION_FAILED",
          message: "Request validation failed",
          requestId: "request-1",
        },
      }),
    }),
  });
  await assert.rejects(client.get("/api/v1/search/tracks?q=x"), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, "VALIDATION_FAILED");
    assert.equal(error.requestId, "request-1");
    return true;
  });
});

test("API client maps network failures to retryable errors", async () => {
  const client = createApiClient({
    baseUrl: "http://auric.test",
    fetchImpl: async () => {
      throw new Error("offline");
    },
  });
  await assert.rejects(client.get("/api/v1/tracks"), (error) => {
    assert.equal(error.code, "NETWORK_ERROR");
    assert.equal(error.retryable, true);
    return true;
  });
});

test("latest search runner debounces and ignores stale responses", async () => {
  const pending = new Map();
  const seen = [];
  const runner = createLatestSearchRunner(
    (query) => new Promise((resolve) => pending.set(query, resolve)),
    0,
  );
  runner.run("old", { onSuccess: (result) => seen.push(result) });
  await new Promise((resolve) => setTimeout(resolve, 5));
  runner.run("new", { onSuccess: (result) => seen.push(result) });
  await new Promise((resolve) => setTimeout(resolve, 5));
  pending.get("new")(["new result"]);
  pending.get("old")(["old result"]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(seen, [["new result"]]);
  runner.cancel();
});

test("creates an encoded canonical stream source without exposing storage state", () => {
  assert.deepEqual(
    createTrackStreamSource("https://auric.test/", "track/id", {
      Authorization: "future-token",
    }),
    {
      uri: "https://auric.test/api/v1/tracks/track%2Fid/stream",
      headers: {
        Accept: "audio/mp4",
        Authorization: "future-token",
      },
    },
  );
});

test("selects real audio only when the server is enabled", () => {
  assert.equal(
    selectAudioEngine({
      useServer: true,
      createMock: () => "mock",
      createExpo: () => "expo",
    }),
    "expo",
  );
  assert.equal(
    selectAudioEngine({
      useServer: false,
      createMock: () => "mock",
      createExpo: () => "expo",
    }),
    "mock",
  );
});

function createFakeAudio() {
  const players = [];
  const calls = [];
  return {
    players,
    calls,
    async setAudioModeAsync(mode) {
      calls.push(["mode", mode]);
    },
    async requestNotificationPermissionsAsync() {
      calls.push(["notification-permission"]);
      return { granted: true };
    },
    createAudioPlayer(source, options) {
      const listeners = [];
      const player = {
        source,
        options,
        listeners,
        addListener(_event, listener) {
          listeners.push(listener);
          return { remove: () => calls.push(["remove-listener", source.uri]) };
        },
        setActiveForLockScreen(active, metadata, lockOptions) {
          calls.push(["lock-screen", active, metadata, lockOptions]);
        },
        clearLockScreenControls() {
          calls.push(["clear-lock-screen", source.uri]);
        },
        play() {
          calls.push(["play", source.uri]);
        },
        pause() {
          calls.push(["pause", source.uri]);
        },
        async seekTo(seconds, before, after) {
          calls.push(["seek", seconds, before, after]);
        },
        remove() {
          calls.push(["remove", source.uri]);
        },
      };
      players.push(player);
      return player;
    },
  };
}

const PLAYABLE_TRACK = {
  id: "track-1",
  title: "Playable",
  artists: ["First", "Second"],
  album: "Album",
  durationMs: 123000,
  hasMedia: true,
};

test("Expo audio adapter loads streams and propagates play, pause, seek, and real status", async () => {
  const audio = createFakeAudio();
  const engine = new ExpoAudioEngineCore({
    audio,
    platformOS: "android",
    createSource: (track) => ({ uri: `https://auric.test/${track.id}` }),
  });
  const statuses = [];
  engine.setOnStatus((status) => statuses.push(status));

  await engine.load(PLAYABLE_TRACK);
  await engine.play();
  await engine.seekTo(4321);
  await engine.pause();
  audio.players[0].listeners[0]({
    currentTime: 4.321,
    duration: 123,
    playing: true,
    isBuffering: false,
    isLoaded: true,
    error: null,
    didJustFinish: false,
  });

  assert.equal(audio.players[0].options.downloadFirst, false);
  assert.equal(audio.players[0].options.updateInterval, 250);
  assert.ok(audio.calls.some((call) => call[0] === "notification-permission"));
  assert.ok(audio.calls.some((call) => call[0] === "lock-screen"));
  assert.ok(audio.calls.some((call) => call[0] === "play"));
  assert.ok(audio.calls.some((call) => call[0] === "pause"));
  assert.ok(
    audio.calls.some((call) => call[0] === "seek" && call[1] === 4.321),
  );
  assert.deepEqual(statuses.at(-1), {
    positionMs: 4321,
    durationMs: 123000,
    isPlaying: true,
    isBuffering: false,
    isLoaded: true,
    error: null,
    trackId: "track-1",
    generation: 1,
  });
});

test("Expo audio adapter rejects metadata-only tracks at the playback boundary", async () => {
  const engine = new ExpoAudioEngineCore({
    audio: createFakeAudio(),
    platformOS: "android",
    createSource: () => ({ uri: "never" }),
  });
  await assert.rejects(
    engine.load({ ...PLAYABLE_TRACK, hasMedia: false }),
    /TRACK_HAS_NO_MEDIA/,
  );
});

test("Expo audio adapter tears down old tracks and ignores stale status events", async () => {
  const audio = createFakeAudio();
  const engine = new ExpoAudioEngineCore({
    audio,
    platformOS: "android",
    createSource: (track) => ({ uri: `https://auric.test/${track.id}` }),
  });
  const statuses = [];
  engine.setOnStatus((status) => statuses.push(status));
  await engine.load(PLAYABLE_TRACK);
  const staleListener = audio.players[0].listeners[0];
  await engine.load({ ...PLAYABLE_TRACK, id: "track-2", title: "Second" });
  const countBeforeStaleEvent = statuses.length;
  staleListener({
    currentTime: 99,
    duration: 123,
    playing: true,
    isBuffering: false,
    isLoaded: true,
    error: null,
    didJustFinish: false,
  });

  assert.equal(statuses.length, countBeforeStaleEvent);
  assert.ok(audio.calls.some((call) => call[0] === "remove"));
  assert.equal(engine.getStatus().trackId, "track-2");
});

test("Expo audio adapter emits one completion and exposes decoder/network errors", async () => {
  const audio = createFakeAudio();
  const engine = new ExpoAudioEngineCore({
    audio,
    platformOS: "android",
    createSource: (track) => ({ uri: `https://auric.test/${track.id}` }),
  });
  const ended = [];
  const statuses = [];
  engine.setOnEnded((event) => ended.push(event));
  engine.setOnStatus((status) => statuses.push(status));
  await engine.load(PLAYABLE_TRACK);
  const event = {
    currentTime: 123,
    duration: 123,
    playing: false,
    isBuffering: false,
    isLoaded: true,
    error: "decoder failed at secret URL",
    didJustFinish: true,
  };
  audio.players[0].listeners[0](event);
  audio.players[0].listeners[0](event);

  assert.equal(ended.length, 1);
  assert.equal(ended[0].trackId, "track-1");
  assert.equal(statuses.at(-1).error, event.error);
});

test("playback policy ignores stale events and advances only for current completion", async () => {
  let nextCalls = 0;
  const handler = createCompletionHandler({
    getCurrentTrackId: () => "current",
    next: async () => {
      nextCalls += 1;
    },
  });
  await handler({ trackId: "stale" });
  await handler({ trackId: "current" });
  assert.equal(isCurrentPlaybackEvent({ trackId: "stale" }, "current"), false);
  assert.equal(nextCalls, 1);
});

test("queue policy skips metadata-only tracks and stops at exhaustion", () => {
  const ids = ["metadata-only", "playable"];
  const tracks = {
    "metadata-only": { id: "metadata-only", hasMedia: false },
    playable: { id: "playable", hasMedia: true },
  };
  const next = takeNextPlayable({
    shift: () => ids.shift() || null,
    getTrack: (id) => tracks[id],
    isPlayable: isTrackPlayable,
  });
  assert.equal(next.id, "playable");
  assert.equal(
    takeNextPlayable({
      shift: () => null,
      getTrack: () => null,
      isPlayable: isTrackPlayable,
    }),
    null,
  );
});

test("restored playback position is clamped and remains a paused-load input", () => {
  assert.equal(normalizeRestoredPosition(4500, 10000), 4500);
  assert.equal(normalizeRestoredPosition(15000, 10000), 10000);
  assert.equal(normalizeRestoredPosition(-5, 10000), 0);
});
