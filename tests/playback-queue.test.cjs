const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DEFAULT_QUEUE_TARGET,
  appendUniqueEntries,
  createQueueRefillCoordinator,
  moveTrackToFront,
  startDirectPlayback,
  takeNextWithEmergency,
} = require("../src/services/playbackQueuePolicy.cjs");
const {
  canOfferTrackActions,
  createExclusivePressHandlers,
  performPlayNextAction,
} = require("../src/services/pressInteraction.cjs");

const playable = (id) => ({ id, title: id, artists: ["Artist"], hasMedia: true });
const entry = (trackId, context = { type: "smart_shuffle", label: "Smart Shuffle" }) => ({
  id: `item-${trackId}`,
  trackId,
  context,
});
const isPlayable = (track) => track?.hasMedia === true;

function coordinatorFixture({
  queueIds = [],
  currentTrackId = "current",
  recentTrackIds = [],
  mode = null,
  smartResult,
  randomResult,
  now,
} = {}) {
  const state = {
    entries: queueIds.map((id) => entry(id)),
    cached: [],
    smartCalls: [],
    randomCalls: [],
  };
  const defaultResult = Array.from({ length: 40 }, (_, index) => playable(`rec-${index}`));
  const coordinator = createQueueRefillCoordinator({
    getQueueEntries: () => state.entries,
    getCurrentTrackId: () => currentTrackId,
    getRecentTrackIds: () => recentTrackIds,
    getMode: () => mode,
    requestSmart: async (count, options) => {
      state.smartCalls.push({ count, options });
      if (smartResult instanceof Error) throw smartResult;
      if (typeof smartResult === "function") return smartResult(count, options);
      return smartResult || defaultResult;
    },
    requestRandom: async (count, options) => {
      state.randomCalls.push({ count, options });
      if (randomResult instanceof Error) throw randomResult;
      if (typeof randomResult === "function") return randomResult(count, options);
      return randomResult || defaultResult;
    },
    cacheTracks: (tracks) => state.cached.push(...tracks),
    appendTracks: (tracks, refillMode) => {
      const context = {
        type: refillMode === "random" ? "random_shuffle" : "smart_shuffle",
        label: refillMode === "random" ? "Random Shuffle" : "Smart Shuffle",
      };
      state.entries = appendUniqueEntries(
        state.entries,
        tracks.map((track) => entry(track.id, context)),
      );
    },
    isPlayable,
    now,
  });
  return { coordinator, state };
}

test("enqueueNext policy moves an existing Track to first with Play Next context and no duplicate", () => {
  const playNext = entry("song-x", { type: "play_next", label: "Play Next" });
  const result = moveTrackToFront(
    [entry("song-b"), entry("song-x"), entry("song-c")],
    playNext,
  );
  assert.deepEqual(result.map((item) => item.trackId), ["song-x", "song-b", "song-c"]);
  assert.deepEqual(result[0].context, { type: "play_next", label: "Play Next" });
});

test("long press invokes track actions without also invoking normal playback", () => {
  const calls = [];
  const handlers = createExclusivePressHandlers({
    onPress: () => calls.push("play"),
    onLongPress: () => calls.push("play-next-menu"),
  });
  handlers.onPressIn();
  handlers.onLongPress();
  handlers.onPress();
  performPlayNextAction({
    track: playable("selected"),
    close: () => calls.push("close"),
    enqueue: (trackId, context) => calls.push([trackId, context]),
  });
  assert.deepEqual(calls, [
    "play-next-menu",
    "close",
    ["selected", { type: "play_next", label: "Play Next" }],
  ]);

  handlers.onPressIn();
  handlers.onPress();
  assert.equal(calls.at(-1), "play");
});

test("direct play resets stale queue and starts smart continuation without awaiting it", async () => {
  const order = [];
  let resolveRefill;
  const refill = new Promise((resolve) => {
    resolveRefill = resolve;
  });
  const directPlay = startDirectPlayback({
    resetQueue: () => order.push("reset"),
    activate: async () => {
      order.push("activate");
      return true;
    },
    refill: () => {
      order.push("refill");
      return refill;
    },
  });
  assert.equal(await directPlay, true);
  assert.deepEqual(order, ["reset", "activate", "refill"]);
  resolveRefill(true);
});

test("a low queue refills to the rolling target while a healthy queue makes no request", async () => {
  const low = coordinatorFixture({ queueIds: ["queued"] });
  assert.equal(await low.coordinator.refill(), true);
  assert.equal(low.state.smartCalls.length, 1);
  assert.equal(low.state.smartCalls[0].count, DEFAULT_QUEUE_TARGET - 1);
  assert.equal(low.state.entries.length, DEFAULT_QUEUE_TARGET);

  const healthy = coordinatorFixture({
    queueIds: Array.from({ length: 9 }, (_, index) => `queued-${index}`),
  });
  assert.equal(await healthy.coordinator.refill(), false);
  assert.equal(healthy.state.smartCalls.length, 0);
});

test("concurrent refill triggers share one network request", async () => {
  let resolveRequest;
  const request = new Promise((resolve) => {
    resolveRequest = resolve;
  });
  const fixture = coordinatorFixture({ smartResult: () => request });
  const first = fixture.coordinator.refill();
  const second = fixture.coordinator.refill();
  assert.equal(fixture.state.smartCalls.length, 1);
  resolveRequest([playable("recommended")]);
  await Promise.all([first, second]);
  assert.equal(fixture.state.smartCalls.length, 1);
});

test("direct-play invalidation drops a stale refill and queues one fresh refill", async () => {
  let resolveStale;
  let requestNumber = 0;
  const staleRequest = new Promise((resolve) => {
    resolveStale = resolve;
  });
  const fixture = coordinatorFixture({
    smartResult: () => {
      requestNumber += 1;
      return requestNumber === 1 ? staleRequest : [playable("fresh-direct")];
    },
  });
  const stale = fixture.coordinator.refill();
  fixture.coordinator.invalidate({ refillAfterPending: true });
  resolveStale([playable("stale")]);
  assert.equal(await stale, false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fixture.state.smartCalls.length, 2);
  assert.deepEqual(fixture.state.entries.map((item) => item.trackId), ["fresh-direct"]);
});

test("smart refill excludes current, queued, and only the bounded recent tail", async () => {
  const recent = Array.from({ length: 30 }, (_, index) => `recent-${index}`);
  const fixture = coordinatorFixture({ queueIds: ["queued"], recentTrackIds: recent });
  await fixture.coordinator.refill();
  const exclusions = fixture.state.smartCalls[0].options.excludeTrackIds;
  assert.ok(exclusions.includes("current"));
  assert.ok(exclusions.includes("queued"));
  assert.ok(exclusions.includes("recent-29"));
  assert.equal(exclusions.includes("recent-9"), false);
  assert.equal(exclusions.filter((id) => id.startsWith("recent-")).length, 20);
});

test("duplicate and unavailable recommendations are filtered before caching and append", async () => {
  const fixture = coordinatorFixture({
    smartResult: [
      playable("fresh"),
      playable("fresh"),
      { ...playable("unavailable"), hasMedia: false },
      playable("current"),
    ],
  });
  await fixture.coordinator.refill();
  assert.deepEqual(fixture.state.cached.map((track) => track.id), ["fresh"]);
  assert.deepEqual(fixture.state.entries.map((item) => item.trackId), ["fresh"]);
});

test("manual Play Next remains first when generated recommendations append", async () => {
  const fixture = coordinatorFixture({
    queueIds: ["manual-next", "existing"],
    smartResult: [playable("generated")],
  });
  fixture.state.entries[0].context = { type: "play_next", label: "Play Next" };
  await fixture.coordinator.refill();
  assert.deepEqual(
    fixture.state.entries.map((item) => item.trackId),
    ["manual-next", "existing", "generated"],
  );
  assert.equal(fixture.state.entries[0].context.type, "play_next");
});

test("refill failure preserves the queue and observes a short cooldown", async () => {
  let nowMs = 1000;
  const fixture = coordinatorFixture({
    queueIds: ["keep-me"],
    smartResult: new Error("offline"),
    now: () => nowMs,
  });
  assert.equal(await fixture.coordinator.refill(), false);
  assert.deepEqual(fixture.state.entries.map((item) => item.trackId), ["keep-me"]);
  assert.equal(await fixture.coordinator.refill(), false);
  assert.equal(fixture.state.smartCalls.length, 1);
  nowMs += 5000;
  await fixture.coordinator.refill();
  assert.equal(fixture.state.smartCalls.length, 2);
});

test("an empty-queue emergency gets one real attempt despite background backoff", async () => {
  const nowMs = 1000;
  let attempt = 0;
  const fixture = coordinatorFixture({
    smartResult: () => {
      attempt += 1;
      if (attempt === 1) throw new Error("background failure");
      return [playable("emergency-track")];
    },
    now: () => nowMs,
  });
  assert.equal(await fixture.coordinator.refill(), false);
  assert.equal(
    await fixture.coordinator.refill({ emergency: true, force: true }),
    true,
  );
  assert.equal(fixture.state.smartCalls.length, 2);
  assert.equal(
    await fixture.coordinator.refill({ emergency: true, force: true }),
    false,
  );
  assert.equal(fixture.state.smartCalls.length, 2);
});

test("empty queue advancement performs exactly one emergency refill before stopping", async () => {
  let emergencyCalls = 0;
  let attempts = 0;
  const result = await takeNextWithEmergency({
    takeNext: () => {
      attempts += 1;
      return null;
    },
    emergencyRefill: async () => {
      emergencyCalls += 1;
      return false;
    },
  });
  assert.equal(result, null);
  assert.equal(emergencyCalls, 1);
  assert.equal(attempts, 2);
});

test("restored low queue refills while a restored healthy queue does not", async () => {
  const restoredLow = coordinatorFixture({ queueIds: ["restored"] });
  await restoredLow.coordinator.refill();
  assert.equal(restoredLow.state.smartCalls.length, 1);

  const restoredHealthy = coordinatorFixture({
    queueIds: Array.from({ length: 12 }, (_, index) => `restored-${index}`),
  });
  await restoredHealthy.coordinator.refill();
  assert.equal(restoredHealthy.state.smartCalls.length, 0);
});

test("Random Shuffle continuation uses random refill with exclusions", async () => {
  const fixture = coordinatorFixture({ mode: "random", randomResult: [playable("random-1")] });
  await fixture.coordinator.refill();
  assert.equal(fixture.state.smartCalls.length, 0);
  assert.equal(fixture.state.randomCalls.length, 1);
  assert.ok(fixture.state.randomCalls[0].options.excludeTrackIds.includes("current"));
  assert.equal(fixture.state.entries[0].context.type, "random_shuffle");
});

test("generated queue never grows beyond the intended rolling-window target", async () => {
  const fixture = coordinatorFixture({
    queueIds: Array.from({ length: 8 }, (_, index) => `queued-${index}`),
  });
  await fixture.coordinator.refill();
  assert.equal(fixture.state.entries.length, DEFAULT_QUEUE_TARGET);
  await fixture.coordinator.refill({ force: true });
  assert.equal(fixture.state.entries.length, DEFAULT_QUEUE_TARGET);
});

test("metadata-only Tracks cannot offer Play Next actions", () => {
  assert.equal(canOfferTrackActions(playable("available")), true);
  assert.equal(
    canOfferTrackActions({ ...playable("metadata-only"), hasMedia: false }),
    false,
  );
});
