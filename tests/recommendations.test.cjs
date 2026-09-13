const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createRecommendationApi,
  createRecommendationRequestCoordinator,
  createLatestRequestGate,
} = require("../src/services/recommendationApi.cjs");
const {
  prepareRecommendationPlayback,
} = require("../src/services/recommendationPlayback.cjs");
const { mapStatsSummary } = require("../src/services/statsApi.cjs");
const {
  createCachedRemoteLoader,
} = require("../src/services/cachedRemoteLoader.cjs");

const TRACK = {
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

test("Quick Picks load maps server reasons and Track DTOs", async () => {
  let requestOptions;
  const api = createRecommendationApi({
    async get(path, options) {
      assert.equal(path, "/api/v1/recommendations/quick-picks");
      requestOptions = options;
      return {
        data: [
          { track: TRACK, reason: "loved", reason_label: "You love this" },
        ],
      };
    },
  });
  const picks = await api.quickPicks({ seed: 42 });
  assert.equal(picks[0].track.durationMs, 100000);
  assert.equal(picks[0].label, "You love this");
  assert.deepEqual(requestOptions.query, { seed: 42 });
});

test("Smart and Random request separate server capabilities", async () => {
  const calls = [];
  const api = createRecommendationApi({
    async post(path, body) {
      calls.push([path, body]);
      return {
        data: {
          algorithm_version: path.includes("random")
            ? "uniform-random-v1"
            : "behavior-v1",
          generated_at_ms: 1,
          seed: 2,
          tracks: [TRACK],
        },
      };
    },
  });
  await api.smartShuffle({ count: 30, excludeTrackIds: [TRACK.id] });
  await api.random({ count: 30 });
  assert.equal(calls[0][0], "/api/v1/recommendations/smart-shuffle");
  assert.deepEqual(calls[0][1].exclude_track_ids, [TRACK.id]);
  assert.equal(calls[1][0], "/api/v1/recommendations/random");
});

test("recommendation responses defensively remove duplicate Track IDs", async () => {
  const api = createRecommendationApi({
    async post() {
      return {
        data: {
          algorithm_version: "behavior-v1",
          generated_at_ms: 1,
          seed: null,
          tracks: [TRACK, TRACK],
        },
      };
    },
  });
  const result = await api.smartShuffle({ count: 30 });
  assert.deepEqual(result.tracks.map((track) => track.id), [TRACK.id]);
});

test("request generations suppress duplicate presses, cross-mode races, and manual invalidation", () => {
  const coordinator = createRecommendationRequestCoordinator();
  const smart = coordinator.begin("smart");
  assert.ok(smart);
  assert.equal(coordinator.begin("smart"), null);
  const random = coordinator.begin("random");
  assert.equal(coordinator.isCurrent(smart), false);
  assert.equal(coordinator.isCurrent(random), true);
  coordinator.invalidate();
  assert.equal(coordinator.isCurrent(random), false);
});

test("a stale Quick Picks refresh cannot replace the newer response", async () => {
  const gate = createLatestRequestGate();
  const applied = [];
  let resolveOld;
  const oldRequest = new Promise((resolve) => {
    resolveOld = resolve;
  });
  const oldToken = gate.begin();
  const old = oldRequest.then((value) => {
    if (gate.isCurrent(oldToken)) applied.push(value);
  });
  const newToken = gate.begin();
  if (gate.isCurrent(newToken)) applied.push("new");
  resolveOld("old");
  await old;
  assert.deepEqual(applied, ["new"]);
});

test("generated queues install through one canonical context shape", () => {
  const second = { ...TRACK, id: "track-2" };
  const smart = prepareRecommendationPlayback([TRACK, second], "smart");
  const random = prepareRecommendationPlayback([TRACK, second], "random");
  assert.equal(smart.first.id, TRACK.id);
  assert.deepEqual(
    smart.upcoming.map((track) => track.id),
    ["track-2"],
  );
  assert.equal(smart.context.type, "smart_shuffle");
  assert.equal(random.context.type, "random_shuffle");
});

test("Stats maps every displayed count from the server summary", () => {
  const summary = mapStatsSummary({
    generated_at_ms: 1,
    window_started_at_ms: 1,
    library_track_count: 7,
    playable_track_count: 6,
    liked_track_count: 2,
    total_listening_ms: 123000,
    meaningful_plays: 4,
    completed_plays: 3,
    tracks_listened_to: 2,
    top_tracks: [{ track: TRACK, meaningful_plays: 4, listened_ms: 123000 }],
    rediscovered_tracks: [TRACK],
  });
  assert.equal(summary.libraryTrackCount, 7);
  assert.equal(summary.totalListeningMs, 123000);
  assert.equal(summary.topTracks[0].meaningfulPlays, 4);
  assert.throws(
    () => mapStatsSummary({ library_track_count: 1684 }),
    /Invalid Stats/,
  );
});

test("Quick Picks and Stats loaders cache success and use it only for offline failure", async () => {
  let cached = null;
  let offline = false;
  const loader = createCachedRemoteLoader({
    loadRemote: async () => {
      if (offline) throw new Error("offline");
      return { count: 7 };
    },
    loadCache: async () => cached,
    saveCache: async (value) => {
      cached = value;
    },
  });
  assert.deepEqual(await loader.load(), { value: { count: 7 }, cached: false });
  offline = true;
  assert.deepEqual(await loader.load(), { value: { count: 7 }, cached: true });

  const noCache = createCachedRemoteLoader({
    loadRemote: async () => {
      throw new Error("offline");
    },
    loadCache: async () => null,
    saveCache: async () => {},
  });
  await assert.rejects(noCache.load(), /offline/);
});

test("cached Home data is available before its remote refresh settles", async () => {
  let resolveRemote;
  const remote = new Promise((resolve) => {
    resolveRemote = resolve;
  });
  const loader = createCachedRemoteLoader({
    loadRemote: () => remote,
    loadCache: async () => ({ count: 7 }),
    saveCache: async () => {},
  });
  const cached = await loader.loadCached();
  const refresh = loader.load();
  assert.deepEqual(cached, { value: { count: 7 }, cached: true });
  resolveRemote({ count: 8 });
  assert.deepEqual(await refresh, { value: { count: 8 }, cached: false });
});
