const assert = require("node:assert/strict");
const test = require("node:test");

const {
  normalizeSearch,
} = require("../src/utils/searchNormalization.cjs");
const {
  createLibraryCacheCoordinator,
} = require("../src/services/libraryCacheCoordinator.cjs");

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
  EVENT,
  TrackPlayerAudioEngineCore,
} = require("../src/services/audio/TrackPlayerAudioEngineCore.cjs");
const {
  createCompletionHandler,
  isCurrentPlaybackEvent,
  normalizeRestoredPosition,
  takeNextPlayable,
} = require("../src/services/audio/playbackPolicy.cjs");
const {
  startDirectPlayback,
} = require("../src/services/playbackQueuePolicy.cjs");

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

test("search normalization preserves Hebrew and normalizes English punctuation", () => {
  assert.equal(normalizeSearch("  חופשת!!!  "), "חופשת");
  assert.equal(normalizeSearch("  עדן   בן זקן  "), "עדן בן זקן");
  assert.equal(normalizeSearch("  Lose-Yourself!  "), "lose yourself");
});

test("library hydration is cache-first, shares refresh work, and rejects stale responses", async () => {
  let resolveRemote;
  let remoteCalls = 0;
  const applied = [];
  const remote = new Promise((resolve) => {
    resolveRemote = resolve;
  });
  const coordinator = createLibraryCacheCoordinator({
    loadCache: async () => ({
      version: 1,
      updatedAtMs: 10,
      tracks: [{ id: "cached" }],
    }),
    saveCache: async () => {},
    loadRemote: () => {
      remoteCalls += 1;
      return remote;
    },
    apply: (tracks) => applied.push(tracks.map((track) => track.id)),
  });

  assert.deepEqual(await coordinator.hydrateCache(), [{ id: "cached" }]);
  const firstRefresh = coordinator.refresh();
  const duplicateRefresh = coordinator.refresh();
  assert.equal(remoteCalls, 1);
  coordinator.markLocalChange();
  resolveRemote([{ id: "stale-remote" }]);
  assert.equal((await firstRefresh).applied, false);
  assert.equal((await duplicateRefresh).applied, false);
  assert.deepEqual(applied, [["cached"]]);
});

test("failed library refresh preserves the applied cache", async () => {
  const applied = [];
  const coordinator = createLibraryCacheCoordinator({
    loadCache: async () => [{ id: "cached" }],
    saveCache: async () => {},
    loadRemote: async () => {
      throw new Error("offline");
    },
    apply: (tracks) => applied.push(tracks.map((track) => track.id)),
  });
  await coordinator.hydrateCache();
  await assert.rejects(coordinator.refresh(), /offline/);
  assert.deepEqual(applied, [["cached"]]);
});

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

function createFakeTrackPlayer() {
  const calls = [];
  const listeners = new Map();
  const player = {
    calls,
    commands: {
      Previous: "previous",
      PlayPause: "playPause",
      Next: "next",
    },
    queue: [],
    activeIndex: null,
    playing: false,
    playbackState: "idle",
    progress: { position: 0, duration: 0, buffered: 0, cached: 0 },
    setupPlayer(config) {
      calls.push(["setup", config]);
    },
    setCommands(config) {
      calls.push(["commands", config]);
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
      return { remove: () => listeners.delete(type) };
    },
    emit(type, payload) {
      if (type === EVENT.PLAYBACK_STATE) this.playbackState = payload.state;
      listeners.get(type)?.(payload);
    },
    setMediaItems(items, startIndex) {
      this.queue = [...items];
      this.activeIndex = startIndex;
      calls.push(["set-items", items.map((item) => item.mediaId)]);
      this.emit(EVENT.MEDIA_ITEM_TRANSITION, {
        item: this.queue[startIndex],
        index: startIndex,
      });
    },
    getQueue() {
      return [...this.queue];
    },
    getActiveMediaItem() {
      return this.activeIndex === null ? null : this.queue[this.activeIndex];
    },
    getActiveMediaItemIndex() {
      return this.activeIndex;
    },
    replaceMediaItem(index, item) {
      this.queue[index] = item;
      calls.push(["replace", index, item.mediaId]);
    },
    addMediaItem(item) {
      this.queue.push(item);
      calls.push(["add", item.mediaId]);
    },
    removeMediaItems(from, to) {
      this.queue.splice(from, to - from);
      if (this.activeIndex >= to) this.activeIndex -= to - from;
      else if (this.activeIndex >= from) this.activeIndex = from;
      calls.push(["remove", from, to]);
    },
    play() {
      this.playing = true;
      calls.push(["play"]);
    },
    pause() {
      this.playing = false;
      calls.push(["pause"]);
    },
    seekTo(seconds) {
      this.progress.position = seconds;
      calls.push(["seek", seconds]);
    },
    skipToNext() {
      calls.push(["next"]);
      if (this.activeIndex + 1 >= this.queue.length) return;
      this.activeIndex += 1;
      this.emit(EVENT.MEDIA_ITEM_TRANSITION, {
        item: this.queue[this.activeIndex],
        index: this.activeIndex,
      });
      this.emit(EVENT.PLAYBACK_STATE, { state: "ready" });
    },
    getProgress() {
      return { ...this.progress };
    },
    getPlaybackState() {
      return this.playbackState;
    },
    isPlaying() {
      return this.playing;
    },
  };
  return player;
}

const PLAYABLE_TRACK = {
  id: "track-1",
  title: "Playable",
  artists: ["First", "Second"],
  album: "Album",
  durationMs: 123000,
  hasMedia: true,
};

test("Track Player adapter configures native queue, media controls, and real status", async () => {
  const player = createFakeTrackPlayer();
  const engine = new TrackPlayerAudioEngineCore({
    player,
    createSource: (track) => ({ uri: `https://auric.test/${track.id}` }),
  });
  const statuses = [];
  engine.setOnStatus((status) => statuses.push(status));

  await engine.load(PLAYABLE_TRACK, {
    currentItemId: "item-1",
    upcoming: [
      {
        id: "item-2",
        itemId: "item-2",
        track: { ...PLAYABLE_TRACK, id: "track-2" },
      },
    ],
  });
  await engine.play();
  await engine.seekTo(4321);
  await engine.pause();
  player.emit(EVENT.PLAYBACK_STATE, { state: "ready" });
  player.emit(EVENT.IS_PLAYING, { playing: true });
  player.emit(EVENT.PROGRESS, {
    mediaId: "item-1",
    position: 4.321,
    duration: 123,
  });

  assert.deepEqual(player.queue.map((item) => item.mediaId), ["item-1", "item-2"]);
  assert.equal(player.calls[0][1].cache.preloading.window, 3);
  assert.deepEqual(player.calls[1][1].capabilities, [
    "previous",
    "playPause",
    "next",
  ]);
  assert.equal(player.calls[1][1].perCommandHandling.previous, "js");
  assert.equal(player.calls[1][1].perCommandHandling.next, "js");
  assert.ok(player.calls.some((call) => call[0] === "play"));
  assert.ok(player.calls.some((call) => call[0] === "pause"));
  assert.ok(
    player.calls.some((call) => call[0] === "seek" && call[1] === 4.321),
  );
  assert.deepEqual(statuses.at(-1), {
    positionMs: 4321,
    durationMs: 123000,
    isPlaying: true,
    isBuffering: false,
    isLoaded: true,
    error: null,
    trackId: "track-1",
    itemId: "item-1",
    generation: 1,
  });
});

test("Quick Play projects successors without QueueScreen or activation readiness", async () => {
  const player = createFakeTrackPlayer();
  const engine = new TrackPlayerAudioEngineCore({
    player,
    createSource: (track) => ({ uri: `https://auric.test/${track.id}` }),
  });
  const successors = ["a", "b", "c"].map((id) => ({
    itemId: `item-${id}`,
    track: { ...PLAYABLE_TRACK, id: `track-${id}` },
  }));
  let finishActivation;
  const nativeReady = new Promise((resolve) => {
    finishActivation = resolve;
  });

  const direct = startDirectPlayback({
    activate: async () => {
      await engine.load(PLAYABLE_TRACK, { currentItemId: "item-current" });
      await nativeReady;
      return true;
    },
    resetQueue: () => {},
    refill: () =>
      engine.syncQueue(
        { track: PLAYABLE_TRACK, itemId: "item-current" },
        successors,
      ),
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(player.queue.map((item) => item.mediaId), [
    "item-current",
    "item-a",
  ]);

  finishActivation();
  assert.equal(await direct, true);
  assert.deepEqual(player.queue.map((item) => item.mediaId), [
    "item-current",
    "item-a",
    "item-b",
    "item-c",
  ]);
});

test("Track Player adapter rejects metadata-only tracks at the playback boundary", async () => {
  const engine = new TrackPlayerAudioEngineCore({
    player: createFakeTrackPlayer(),
    createSource: () => ({ uri: "never" }),
  });
  await assert.rejects(
    engine.load({ ...PLAYABLE_TRACK, hasMedia: false }),
    /TRACK_HAS_NO_MEDIA/,
  );
});

test("Track Player adapter ignores stale transition and progress events", async () => {
  const player = createFakeTrackPlayer();
  const engine = new TrackPlayerAudioEngineCore({
    player,
    createSource: (track) => ({ uri: `https://auric.test/${track.id}` }),
  });
  const statuses = [];
  engine.setOnStatus((status) => statuses.push(status));
  await engine.load(PLAYABLE_TRACK, { currentItemId: "item-1" });
  await engine.load(
    { ...PLAYABLE_TRACK, id: "track-2", title: "Second" },
    { currentItemId: "item-2" },
  );
  const countBeforeStaleEvent = statuses.length;
  engine.handleNativeEvent({
    type: EVENT.PROGRESS,
    mediaId: "item-1",
    position: 99,
    duration: 123,
  });

  assert.equal(statuses.length, countBeforeStaleEvent);
  assert.equal(engine.getStatus().trackId, "track-2");
});

test("reserved activation generation rejects stale load and play before native mutation", async () => {
  const player = createFakeTrackPlayer();
  const engine = new TrackPlayerAudioEngineCore({
    player,
    createSource: (track) => ({ uri: `https://auric.test/${track.id}` }),
  });
  const generationA = engine.beginActivation();
  const generationB = engine.beginActivation();
  const trackB = { ...PLAYABLE_TRACK, id: "track-B" };

  await assert.rejects(
    engine.load(PLAYABLE_TRACK, {
      currentItemId: "item-A",
      activationGeneration: generationA,
    }),
    /STALE_ACTIVATION/,
  );
  await engine.load(trackB, {
    currentItemId: "item-B",
    activationGeneration: generationB,
  });
  assert.throws(() => engine.play(generationA), /STALE_ACTIVATION/);
  engine.play(generationB);

  assert.deepEqual(player.queue.map((item) => item.mediaId), ["item-B"]);
  assert.equal(engine.getStatus().trackId, "track-B");
  assert.equal(player.calls.filter(([name]) => name === "play").length, 1);
});

test("direct activation cancels an older pending native Next transition", async () => {
  const player = createFakeTrackPlayer();
  const engine = new TrackPlayerAudioEngineCore({
    player,
    createSource: (track) => ({ uri: `https://auric.test/${track.id}` }),
  });
  await engine.load(PLAYABLE_TRACK, {
    currentItemId: "item-current",
    upcoming: [
      {
        itemId: "item-next",
        track: { ...PLAYABLE_TRACK, id: "track-next" },
      },
    ],
  });
  player.skipToNext = function skipWithoutTransition() {
    this.calls.push(["next"]);
  };
  const pendingNext = engine.next();

  engine.beginActivation();

  await assert.rejects(pendingNext, /STALE_ACTIVATION/);
});

test("cold headless transition recovers and awaits native queue synchronization", async () => {
  const player = createFakeTrackPlayer();
  const item = (trackId, itemId) => ({
    mediaId: itemId,
    url: {
      uri: `https://auric.test/${trackId}`,
      headers: { Authorization: "Bearer device-token" },
    },
    extras: { trackId, itemId, context: { type: "manual_queue" } },
  });
  player.queue = [
    item("track-current", "item-current"),
    item("track-next", "item-next"),
    item("track-later", "item-later"),
  ];
  player.activeIndex = 1;
  player.playing = true;
  const engine = new TrackPlayerAudioEngineCore({
    player,
    createSource: (track) => ({ uri: `https://auric.test/${track.id}` }),
  });
  const transitions = [];
  let synchronizationFinished = false;
  engine.setOnTrackChanged(async (event) => {
    transitions.push(event);
    await new Promise((resolve) => setImmediate(resolve));
    synchronizationFinished = true;
  });

  await engine.handleNativeEvent({
    type: EVENT.MEDIA_ITEM_TRANSITION,
    item: player.queue[1],
    index: 1,
  });

  assert.equal(synchronizationFinished, true);
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].previousTrackId, "track-current");
  assert.equal(transitions[0].previousItemId, "item-current");
  assert.equal(transitions[0].itemId, "item-next");
  assert.equal(engine.getStatus().isPlaying, true);

  const synchronized = await engine.syncQueue(
    {
      track: { ...PLAYABLE_TRACK, id: "track-next" },
      itemId: "item-next",
      context: { type: "manual_queue" },
    },
    [
      {
        id: "item-later",
        itemId: "item-later",
        track: { ...PLAYABLE_TRACK, id: "track-later" },
        context: { type: "manual_queue" },
      },
    ],
  );
  assert.equal(synchronized, true);
  assert.deepEqual(player.queue.map((entry) => entry.mediaId), [
    "item-next",
    "item-later",
  ]);
});

test("cold adopted native active item is reconciled instead of silently rejected", async () => {
  const player = createFakeTrackPlayer();
  const item = (trackId, itemId) => ({
    mediaId: itemId,
    url: { uri: `https://auric.test/${trackId}` },
    extras: { trackId, itemId, context: { type: "manual_queue" } },
  });
  player.queue = [
    item("track-current", "item-current"),
    item("track-next", "item-next"),
  ];
  player.activeIndex = 1;
  const engine = new TrackPlayerAudioEngineCore({
    player,
    createSource: (track) => ({ uri: `https://auric.test/${track.id}` }),
  });
  const transitions = [];
  engine.setOnTrackChanged((event) => transitions.push(event));
  engine.handleNativeEvent({ type: EVENT.IS_PLAYING, playing: true });

  const changed = await engine.syncQueue(
    {
      track: { ...PLAYABLE_TRACK, id: "track-current" },
      itemId: "item-current",
    },
    [
      {
        itemId: "item-next",
        track: { ...PLAYABLE_TRACK, id: "track-next" },
      },
    ],
  );

  assert.equal(changed, false);
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].itemId, "item-next");
  assert.deepEqual(transitions[0].nativeItemIds, [
    "item-current",
    "item-next",
  ]);
});

test("remote and in-app Next share one pending native transition", async () => {
  const player = createFakeTrackPlayer();
  const engine = new TrackPlayerAudioEngineCore({
    player,
    createSource: (track) => ({ uri: `https://auric.test/${track.id}` }),
  });
  const nextTrack = { ...PLAYABLE_TRACK, id: "track-next" };
  await engine.load(PLAYABLE_TRACK, {
    currentItemId: "item-current",
    upcoming: [{ itemId: "item-next", track: nextTrack }],
  });
  let transitionCount = 0;
  engine.setOnTrackChanged(() => {
    transitionCount += 1;
  });
  engine.setOnRemoteNext(() => engine.next("skipped_next"));
  player.skipToNext = function skipToNextWithoutImmediateEvent() {
    this.calls.push(["next"]);
    this.activeIndex += 1;
  };

  const remote = engine.handleNativeEvent({ type: EVENT.REMOTE_NEXT });
  const inApp = engine.next("skipped_next");
  assert.equal(remote, inApp);
  assert.equal(player.calls.filter(([name]) => name === "next").length, 1);

  const active = player.getActiveMediaItem();
  await engine.handleNativeEvent({
    type: EVENT.MEDIA_ITEM_TRANSITION,
    item: active,
    index: player.activeIndex,
  });
  engine.handleNativeEvent({ type: EVENT.PLAYBACK_STATE, state: "ready" });
  assert.equal(await remote, true);
  assert.equal(await inApp, true);
  assert.equal(transitionCount, 1);
  assert.equal(engine.getStatus().itemId, "item-next");
  assert.equal(player.playing, true);
});

test("explicit Next keeps playing when current playback was already playing", async () => {
  const player = createFakeTrackPlayer();
  const engine = new TrackPlayerAudioEngineCore({
    player,
    createSource: (track) => ({ uri: `https://auric.test/${track.id}` }),
  });
  await engine.load(PLAYABLE_TRACK, {
    currentItemId: "item-current",
    upcoming: [
      {
        itemId: "item-next",
        track: { ...PLAYABLE_TRACK, id: "track-next" },
      },
    ],
  });
  engine.play();

  assert.equal(await engine.next("skipped_next"), true);
  assert.equal(player.getActiveMediaItem().mediaId, "item-next");
  assert.equal(player.playing, true);
});

test("authenticated native stream failure is specific, clears once, and never retries", async () => {
  const player = createFakeTrackPlayer();
  const failedTokens = [];
  const engine = new TrackPlayerAudioEngineCore({
    player,
    createSource: (track) => ({
      uri: `https://auric.test/${track.id}`,
      headers: { Authorization: "Bearer device-token" },
    }),
    onAuthenticationFailure: (token) => failedTokens.push(token),
  });
  const statuses = [];
  engine.setOnStatus((status) => statuses.push(status));
  await engine.load(PLAYABLE_TRACK, { currentItemId: "item-1" });
  const event = {
    type: EVENT.PLAYBACK_ERROR,
    code: "source",
    message: "HTTP response code: 401",
  };
  engine.handleNativeEvent(event);
  engine.handleNativeEvent(event);

  assert.deepEqual(failedTokens, ["device-token"]);
  assert.equal(statuses.at(-1).error.code, "AUTHENTICATION_REQUIRED");
  assert.equal(player.calls.some((call) => call[0] === "next"), false);
});

test("opaque native source errors use one canonical auth probe", async () => {
  const player = createFakeTrackPlayer();
  const probes = [];
  const failedTokens = [];
  const engine = new TrackPlayerAudioEngineCore({
    player,
    createSource: (track) => ({
      uri: `https://auric.test/${track.id}`,
      headers: { Authorization: "Bearer expired-token" },
    }),
    onSourceFailure: async (failure) => {
      probes.push(failure);
      return true;
    },
    onAuthenticationFailure: (token) => failedTokens.push(token),
  });
  await engine.load(PLAYABLE_TRACK, { currentItemId: "item-1" });
  engine.handleNativeEvent({
    type: EVENT.PLAYBACK_ERROR,
    code: "source",
    message: "Source error",
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(probes.length, 1);
  assert.equal(probes[0].trackId, PLAYABLE_TRACK.id);
  assert.deepEqual(failedTokens, ["expired-token"]);
  assert.equal(engine.getStatus().error.code, "AUTHENTICATION_REQUIRED");
});

test("opaque network and server failures neither re-probe nor clear auth", async () => {
  for (const failure of ["timeout", "http-500", "dns"]) {
    const player = createFakeTrackPlayer();
    const probes = [];
    const failedTokens = [];
    const engine = new TrackPlayerAudioEngineCore({
      player,
      createSource: (track) => ({
        uri: `https://auric.test/${track.id}`,
        headers: { Authorization: "Bearer valid-token" },
      }),
      onSourceFailure: async (details) => {
        probes.push(details);
        return false;
      },
      onAuthenticationFailure: (token) => failedTokens.push(token),
    });
    await engine.load(PLAYABLE_TRACK, { currentItemId: `item-${failure}` });
    const event = {
      type: EVENT.PLAYBACK_ERROR,
      code: "source",
      message: failure,
    };
    await engine.handleNativeEvent(event);
    await engine.handleNativeEvent(event);
    assert.equal(probes.length, 1);
    assert.deepEqual(failedTokens, []);
  }
});

test("successor projection refresh patches the native tail without interrupting current", async () => {
  const player = createFakeTrackPlayer();
  const engine = new TrackPlayerAudioEngineCore({
    player,
    createSource: (track) => ({ uri: `https://auric.test/${track.id}` }),
  });
  const spec = (id) => ({
    id: `item-${id}`,
    itemId: `item-${id}`,
    track: { ...PLAYABLE_TRACK, id },
  });
  await engine.load(PLAYABLE_TRACK, {
    currentItemId: "current-item",
    upcoming: [spec("a"), spec("b"), spec("c")],
  });
  const setCalls = player.calls.filter(([name]) => name === "set-items").length;
  const changed = await engine.syncQueue(
    { track: PLAYABLE_TRACK, itemId: "current-item" },
    [spec("play-next"), spec("a"), spec("b")],
  );
  assert.equal(changed, true);
  assert.equal(player.getActiveMediaItem().mediaId, "current-item");
  assert.deepEqual(player.queue.map((item) => item.mediaId), [
    "current-item",
    "item-play-next",
    "item-a",
    "item-b",
  ]);
  assert.equal(
    player.calls.filter(([name]) => name === "set-items").length,
    setCalls,
  );
});

test("repeating the same successor projection performs no duplicate native mutation", async () => {
  const player = createFakeTrackPlayer();
  const engine = new TrackPlayerAudioEngineCore({
    player,
    createSource: (track) => ({ uri: `https://auric.test/${track.id}` }),
  });
  const successor = {
    id: "item-next",
    itemId: "item-next",
    track: { ...PLAYABLE_TRACK, id: "track-next" },
  };
  await engine.load(PLAYABLE_TRACK, {
    currentItemId: "item-current",
    upcoming: [successor],
  });
  const callsBefore = player.calls.length;

  assert.equal(
    await engine.syncQueue(
      { track: PLAYABLE_TRACK, itemId: "item-current" },
      [successor],
    ),
    false,
  );
  assert.equal(player.calls.length, callsBefore);
});

test("cached projection cannot hide a native queue that dropped its successors", async () => {
  const player = createFakeTrackPlayer();
  const engine = new TrackPlayerAudioEngineCore({
    player,
    createSource: (track) => ({ uri: `https://auric.test/${track.id}` }),
  });
  const successor = {
    id: "item-next",
    itemId: "item-next",
    track: { ...PLAYABLE_TRACK, id: "track-next" },
  };
  await engine.load(PLAYABLE_TRACK, {
    currentItemId: "item-current",
    upcoming: [successor],
  });

  // Reproduces the device gap: JS remembers the intended projection while
  // RNTP exposes only the active item.
  player.queue = [player.queue[0]];
  player.activeIndex = 0;

  assert.equal(
    await engine.syncQueue(
      { track: PLAYABLE_TRACK, itemId: "item-current" },
      [successor],
    ),
    true,
  );
  assert.deepEqual(player.queue.map((item) => item.mediaId), [
    "item-current",
    "item-next",
  ]);
});

test("projection waits for delayed native tail acceptance before caching success", async () => {
  const player = createFakeTrackPlayer();
  const immediateAdd = player.addMediaItem;
  player.addMediaItem = function delayedAdd(item) {
    setTimeout(() => immediateAdd.call(this, item), 5);
  };
  const engine = new TrackPlayerAudioEngineCore({
    player,
    createSource: (track) => ({ uri: `https://auric.test/${track.id}` }),
    queueAcceptanceIntervalMs: 10,
  });
  await engine.load(PLAYABLE_TRACK, { currentItemId: "item-current" });
  const successors = ["a", "b", "c"].map((id) => ({
    id: `item-${id}`,
    itemId: `item-${id}`,
    track: { ...PLAYABLE_TRACK, id: `track-${id}` },
  }));

  assert.equal(
    await engine.syncQueue(
      { track: PLAYABLE_TRACK, itemId: "item-current" },
      successors,
    ),
    true,
  );
  assert.deepEqual(player.queue.map((item) => item.mediaId), [
    "item-current",
    "item-a",
    "item-b",
    "item-c",
  ]);
});

test("failed native acceptance never caches the requested projection", async () => {
  const player = createFakeTrackPlayer();
  const engine = new TrackPlayerAudioEngineCore({
    player,
    createSource: (track) => ({ uri: `https://auric.test/${track.id}` }),
    queueAcceptanceTimeoutMs: 10,
    queueAcceptanceIntervalMs: 1,
  });
  await engine.load(PLAYABLE_TRACK, { currentItemId: "item-current" });
  player.addMediaItem = function ignoreNativeMutation(item) {
    this.calls.push(["ignored-add", item.mediaId]);
  };
  const successor = {
    itemId: "item-next",
    track: { ...PLAYABLE_TRACK, id: "track-next" },
  };

  await assert.rejects(
    engine.syncQueue(
      { track: PLAYABLE_TRACK, itemId: "item-current" },
      [successor],
    ),
    /NATIVE_QUEUE_NOT_READY/,
  );
  assert.deepEqual(engine.projection.map((item) => item.itemId), [
    "item-current",
  ]);
  assert.deepEqual(engine.getNativePlaybackSnapshot(), {
    nativeActiveMediaId: "item-current",
    nativeActiveIndex: 0,
    nativeQueueMediaIds: ["item-current"],
    nativeIsPlaying: false,
  });
});

test("Direct and playQueued settle to the same verified native queue shape", async () => {
  const successors = ["a", "b", "c"].map((id) => ({
    itemId: `item-${id}`,
    track: { ...PLAYABLE_TRACK, id: `track-${id}` },
  }));
  const directPlayer = createFakeTrackPlayer();
  const queuedPlayer = createFakeTrackPlayer();
  const makeEngine = (player) =>
    new TrackPlayerAudioEngineCore({
      player,
      createSource: (track) => ({ uri: `https://auric.test/${track.id}` }),
    });
  const direct = makeEngine(directPlayer);
  const queued = makeEngine(queuedPlayer);

  await direct.load(PLAYABLE_TRACK, { currentItemId: "item-current" });
  assert.deepEqual(direct.getNativePlaybackSnapshot().nativeQueueMediaIds, [
    "item-current",
  ]);
  await direct.syncQueue(
    { track: PLAYABLE_TRACK, itemId: "item-current" },
    successors,
  );
  await queued.load(PLAYABLE_TRACK, {
    currentItemId: "item-current",
    upcoming: successors,
  });

  assert.deepEqual(
    direct.getNativePlaybackSnapshot().nativeQueueMediaIds,
    queued.getNativePlaybackSnapshot().nativeQueueMediaIds,
  );
  assert.deepEqual(direct.getNativePlaybackSnapshot().nativeQueueMediaIds, [
    "item-current",
    "item-a",
    "item-b",
    "item-c",
  ]);
});

test("explicit Next starts its successor when current playback is paused", async () => {
  const player = createFakeTrackPlayer();
  const engine = new TrackPlayerAudioEngineCore({
    player,
    createSource: (track) => ({ uri: `https://auric.test/${track.id}` }),
  });
  await engine.load(PLAYABLE_TRACK, {
    currentItemId: "item-current",
    upcoming: [
      {
        itemId: "item-next",
        track: { ...PLAYABLE_TRACK, id: "track-next" },
      },
    ],
  });
  player.playing = false;

  assert.equal(await engine.next("skipped_next"), true);
  assert.equal(player.getActiveMediaItem().mediaId, "item-next");
  assert.equal(player.playing, true);
  assert.equal(player.calls.at(-1)[0], "play");
});

test("explicit Next waits for the intended successor to become ready before play", async () => {
  const player = createFakeTrackPlayer();
  player.skipToNext = function skipWithoutReady() {
    this.calls.push(["next"]);
    this.activeIndex += 1;
    this.emit(EVENT.MEDIA_ITEM_TRANSITION, {
      item: this.queue[this.activeIndex],
      index: this.activeIndex,
    });
  };
  const engine = new TrackPlayerAudioEngineCore({
    player,
    createSource: (track) => ({ uri: `https://auric.test/${track.id}` }),
    explicitPlayTimeoutMs: 100,
    explicitPlayIntervalMs: 1,
  });
  await engine.load(PLAYABLE_TRACK, {
    currentItemId: "item-current",
    upcoming: [
      {
        itemId: "item-next",
        track: { ...PLAYABLE_TRACK, id: "track-next" },
      },
    ],
  });
  const advanced = engine.next("skipped_next");
  await Promise.resolve();
  assert.equal(player.calls.filter(([name]) => name === "play").length, 0);

  player.emit(EVENT.PLAYBACK_STATE, { state: "ready" });
  assert.equal(await advanced, true);
  assert.equal(player.getActiveMediaItem().mediaId, "item-next");
  assert.equal(player.playing, true);
});

test("a late paused-state event cannot overwrite the playing successor", async () => {
  const player = createFakeTrackPlayer();
  const engine = new TrackPlayerAudioEngineCore({
    player,
    createSource: (track) => ({ uri: `https://auric.test/${track.id}` }),
  });
  await engine.load(PLAYABLE_TRACK, {
    currentItemId: "item-current",
    upcoming: [
      {
        itemId: "item-next",
        track: { ...PLAYABLE_TRACK, id: "track-next" },
      },
    ],
  });
  assert.equal(await engine.next("skipped_next"), true);
  player.emit(EVENT.IS_PLAYING, { playing: false });

  assert.equal(player.playing, true);
  assert.equal(engine.getStatus().isPlaying, true);
});

test("cold remote Previous reconciles the active native item before invoking history", async () => {
  const player = createFakeTrackPlayer();
  const item = (trackId, itemId) => ({
    mediaId: itemId,
    url: { uri: `https://auric.test/${trackId}` },
    extras: { trackId, itemId, context: { type: "smart_shuffle" } },
  });
  player.queue = [
    item("track-old", "item-old"),
    item("track-current", "item-current"),
  ];
  player.activeIndex = 1;
  player.progress.position = 6;
  const engine = new TrackPlayerAudioEngineCore({
    player,
    createSource: (track) => ({ uri: `https://auric.test/${track.id}` }),
  });
  const order = [];
  engine.setOnTrackChanged(async (event) => {
    order.push(["reconciled", event.itemId]);
  });
  engine.setOnRemotePrevious(async () => {
    order.push(["previous", engine.getStatus().positionMs]);
    return true;
  });

  assert.equal(
    await engine.handleNativeEvent({ type: EVENT.REMOTE_PREVIOUS }),
    true,
  );
  assert.deepEqual(order, [
    ["reconciled", "item-current"],
    ["previous", 6000],
  ]);
});

test("remote Previous awaits the canonical callback through persistence", async () => {
  const player = createFakeTrackPlayer();
  const engine = new TrackPlayerAudioEngineCore({
    player,
    createSource: (track) => ({ uri: `https://auric.test/${track.id}` }),
  });
  await engine.load(PLAYABLE_TRACK, { currentItemId: "item-current" });
  let releasePersistence;
  let completed = false;
  engine.setOnRemotePrevious(async () => {
    await new Promise((resolve) => {
      releasePersistence = resolve;
    });
    completed = true;
    return true;
  });

  const remote = engine.handleNativeEvent({ type: EVENT.REMOTE_PREVIOUS });
  await Promise.resolve();
  assert.equal(completed, false);
  releasePersistence();
  assert.equal(await remote, true);
  assert.equal(completed, true);
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
