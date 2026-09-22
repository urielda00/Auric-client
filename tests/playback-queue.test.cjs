const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const {
  createRecommendationRequestCoordinator,
} = require("../src/services/recommendationApi.cjs");

const {
  DEFAULT_QUEUE_TARGET,
  DEFAULT_REFILL_THRESHOLD,
  buildContextSelection,
  appendUniqueEntries,
  commitAfterActivation,
  createQueueRefillCoordinator,
  moveTrackToFront,
  runExplicitNext,
  takeNextWithEmergency,
} = require("../src/services/playbackQueuePolicy.cjs");

test("explicit Next reconciles a stale native queue before advancing", async () => {
  const order = [];
  let nativeAccepted = false;
  const advanced = await runExplicitNext({
    hasLogicalSuccessor: () => true,
    reconcile: async () => {
      order.push("reconcile");
      nativeAccepted = true;
      return true;
    },
    advance: async () => {
      assert.equal(nativeAccepted, true);
      order.push("advance");
      return true;
    },
    emergencyRefill: async () => order.push("refill"),
    pauseAtExhaustion: async () => order.push("pause"),
  });

  assert.equal(advanced, true);
  assert.deepEqual(order, ["reconcile", "advance"]);
});

test("explicit Next never pauses current when logical successor reconciliation fails", async () => {
  const order = [];
  const advanced = await runExplicitNext({
    hasLogicalSuccessor: () => true,
    reconcile: async () => {
      order.push("reconcile");
      return false;
    },
    advance: async () => {
      order.push("advance");
      return false;
    },
    emergencyRefill: async () => order.push("refill"),
    pauseAtExhaustion: async () => order.push("pause"),
  });

  assert.equal(advanced, false);
  assert.deepEqual(order, ["reconcile"]);
});

test("explicit Next pauses only after a truly exhausted refill", async () => {
  const order = [];
  const advanced = await runExplicitNext({
    hasLogicalSuccessor: () => false,
    reconcile: async () => {
      order.push("reconcile");
      return true;
    },
    advance: async () => {
      order.push("advance");
      return false;
    },
    emergencyRefill: async () => order.push("refill"),
    pauseAtExhaustion: async () => order.push("pause"),
  });

  assert.equal(advanced, false);
  assert.deepEqual(order, ["refill", "pause"]);
});

test("Next does not advance a replacement context after reconciliation", async () => {
  let currentItemId = "item-a";
  let advances = 0;
  const result = await runExplicitNext({
    isCurrent: () => currentItemId === "item-a",
    hasLogicalSuccessor: () => true,
    reconcile: async () => {
      currentItemId = "item-b";
      return true;
    },
    advance: async () => { advances += 1; return true; },
    emergencyRefill: async () => {},
    pauseAtExhaustion: async () => {},
  });
  assert.equal(result, false);
  assert.equal(advances, 0);
});
const {
  NATIVE_PRELOAD_COUNT,
  appendAdvancedHistory,
  buildNativeProjection,
  buildPreviousQueue,
  classifyPlaybackError,
  consumeNativeTransition,
  createIdempotentTransitionTracker,
  createTransitionGate,
  selectPreviousAction,
} = require("../src/services/audio/nativeQueuePolicy.cjs");
const {
  canOfferTrackActions,
  createExclusivePressHandlers,
  playTrackFromList,
  performPlayNextAction,
} = require("../src/services/pressInteraction.cjs");

const playable = (id) => ({ id, title: id, artists: ["Artist"], hasMedia: true });
const entry = (trackId, context = { type: "smart_shuffle", label: "Smart Shuffle" }) => ({
  id: `item-${trackId}`,
  trackId,
  context,
});
const isPlayable = (track) => track?.hasMedia === true;

test("two-successor preload setting is independent of full native queue projection", () => {
  assert.equal(NATIVE_PRELOAD_COUNT, 2);
  assert.ok(DEFAULT_REFILL_THRESHOLD > NATIVE_PRELOAD_COUNT);
  const upcoming = Array.from({ length: DEFAULT_QUEUE_TARGET }, (_, index) => ({
    id: `item-${index}`,
    track: playable(`next-${index}`),
  }));
  const projection = buildNativeProjection({
    current: { itemId: "current-item", track: playable("current") },
    upcoming,
    isPlayable,
  });
  assert.equal(projection.length, DEFAULT_QUEUE_TARGET + 1);
});

test("context selection keeps list order for first, middle, last, and a single track", () => {
  const available = () => true;
  assert.deepEqual(buildContextSelection("a", ["a", "b", "c"], available), {
    previous: [], upcoming: ["b", "c"],
  });
  assert.deepEqual(buildContextSelection("b", ["a", "b", "c"], available), {
    previous: ["a"], upcoming: ["c"],
  });
  assert.deepEqual(buildContextSelection("c", ["a", "b", "c"], available), {
    previous: ["a", "b"], upcoming: [],
  });
  assert.deepEqual(buildContextSelection("only", ["only"], available), {
    previous: [], upcoming: [],
  });
});

test("a real row press passes its middle selection and complete list into context playback", () => {
  const tracks = [playable("first"), playable("middle"), playable("last")];
  const context = { type: "liked_songs", label: "Liked Songs" };
  let call;
  const handlers = createExclusivePressHandlers({
    onPress: () => playTrackFromList({
      track: tracks[1], tracks, index: 1, context,
      playTrackFromContext: (...args) => { call = args; return true; },
    }),
  });
  handlers.onPressIn();
  handlers.onPress();
  assert.deepEqual(call, ["middle", tracks, context, 1]);
  const selection = buildContextSelection(call[0], call[1], () => true, call[3]);
  assert.deepEqual(selection.upcoming, ["last"]);
  const { deriveQueueTimeline } = require("../src/features/queue/queueTimeline.cjs");
  const timeline = deriveQueueTimeline({
    currentTrackId: "middle", currentItemId: "current-middle", playbackContext: context,
    queueEntries: selection.upcoming.map((trackId) => entry(trackId, context)),
    tracksById: Object.fromEntries(tracks.map((track) => [track.id, track])),
  });
  assert.deepEqual(timeline.upcoming.map((item) => item.trackId), ["last"]);
});

test("a repeated History row keeps its tapped occurrence index", () => {
  const tracks = [playable("repeat"), playable("between"), playable("repeat"), playable("after")];
  let selected;
  const handlers = createExclusivePressHandlers({
    onPress: () => playTrackFromList({
      track: tracks[2], tracks, index: 2,
      context: { type: "history", label: "History" },
      playTrackFromContext: (...args) => { selected = args; return true; },
    }),
  });
  handlers.onPressIn();
  handlers.onPress();
  assert.equal(selected[3], 2);
  assert.deepEqual(buildContextSelection(selected[0], selected[1], () => true, selected[3]).upcoming, ["after"]);
});

test("all present track entry screens wire row or card taps through the context handler", () => {
  for (const screen of ["home/HomeScreen", "liked/LikedScreen", "search/SearchScreen", "history/HistoryScreen"]) {
    const source = readFileSync(join(process.cwd(), "src/features", `${screen}.js`), "utf8");
    assert.match(source, /playTrackFromList\(\{/);
    assert.match(source, /playTrackFromContext,/);
  }
});

test("context selection filters unavailable songs and distinguishes repeated history rows", () => {
  const available = (id) => id !== "missing";
  assert.deepEqual(buildContextSelection("a", ["a", "missing", "b", "a", "c"], available, 3), {
    previous: ["a", "b"], upcoming: ["c"],
  });
  assert.equal(buildContextSelection("a", ["b", "a"], available, 0), null);
  assert.deepEqual(buildContextSelection("other", ["other", "later"], available), {
    previous: [], upcoming: ["later"],
  });
});

function coordinatorFixture({
  queueIds = [],
  currentTrackId = "current",
  recentTrackIds = [],
  mode = null,
  smartResult,
  randomResult,
  now,
  trace,
} = {}) {
  const state = {
    currentTrackId,
    recentTrackIds,
    entries: queueIds.map((id) => entry(id)),
    cached: [],
    smartCalls: [],
    randomCalls: [],
  };
  const defaultResult = Array.from({ length: 40 }, (_, index) => playable(`rec-${index}`));
  const coordinator = createQueueRefillCoordinator({
    getQueueEntries: () => state.entries,
    getCurrentTrackId: () => state.currentTrackId,
    getRecentTrackIds: () => state.recentTrackIds,
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
    trace,
    appendTracks: (tracks, refillMode) => {
      const context = {
        type: refillMode === "random" ? "random_shuffle"
          : "smart_shuffle",
        label: refillMode === "random" ? "Random Shuffle"
          : refillMode === "smart" ? "Smart Shuffle" : "Recommended",
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

test("failed queued activation preserves the logical item until commit", async () => {
  const queue = [entry("queued")];
  const result = await commitAfterActivation({
    activate: async () => false,
    commit: () => queue.shift(),
  });
  assert.equal(result, false);
  assert.deepEqual(queue.map((item) => item.trackId), ["queued"]);
});

test("native projection contains the full playable upcoming context", () => {
  const logical = [
    entry("one"),
    entry("missing"),
    entry("two"),
    entry("three"),
    entry("four"),
  ];
  const tracks = Object.fromEntries(
    ["one", "two", "three", "four"].map((id) => [id, playable(id)]),
  );
  const before = JSON.parse(JSON.stringify(logical));
  const projection = buildNativeProjection({
    current: {
      track: playable("current"),
      itemId: "current-item",
      context: { type: "direct", label: "Library" },
    },
    upcoming: logical,
    getTrack: (id) => tracks[id],
    isPlayable,
  });
  assert.equal(projection.length, 5);
  assert.deepEqual(
    projection.map((item) => item.track.id),
    ["current", "one", "two", "three", "four"],
  );
  assert.deepEqual(logical, before);
});

test("Play Next, reorder, and remove derive a new successor projection without changing current", () => {
  const current = { track: playable("current"), itemId: "current-item" };
  const first = buildNativeProjection({
    current,
    upcoming: [entry("a"), entry("b"), entry("c")],
    getTrack: playable,
    isPlayable,
  });
  const edited = buildNativeProjection({
    current,
    upcoming: [entry("play-next"), entry("c"), entry("a")],
    getTrack: playable,
    isPlayable,
  });
  assert.equal(first[0].itemId, edited[0].itemId);
  assert.deepEqual(
    edited.slice(1).map((item) => item.track.id),
    ["play-next", "c", "a"],
  );
});

test("rapid repeated Next shares one transition operation", async () => {
  const gate = createTransitionGate();
  let calls = 0;
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const first = gate.run(async () => {
    calls += 1;
    return pending;
  });
  const second = gate.run(async () => {
    calls += 1;
  });
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(calls, 1);
  finish(true);
  assert.equal(await first, true);
});

test("native advancement consumes the first logical item exactly once", () => {
  const queue = [entry("next"), entry("later")];
  const event = {
    previousItemId: "current-item",
    itemId: queue[0].id,
    trackId: "next",
  };
  const transition = consumeNativeTransition({
    currentItemId: "current-item",
    event,
    queueEntries: queue,
  });
  assert.equal(transition.accepted, true);
  assert.deepEqual(transition.remaining.map((item) => item.trackId), ["later"]);
  const stale = consumeNativeTransition({
    currentItemId: queue[0].id,
    event,
    queueEntries: transition.remaining,
  });
  assert.equal(stale.accepted, false);
});

test("delayed background reconciliation consumes every native hop exactly once", () => {
  const queue = [entry("next-1"), entry("next-2"), entry("next-3")];
  const transition = consumeNativeTransition({
    currentItemId: "item-current",
    event: {
      previousItemId: queue[0].id,
      itemId: queue[1].id,
      trackId: "next-2",
      nativeItemIds: ["item-current", queue[0].id, queue[1].id],
    },
    queueEntries: queue,
  });
  assert.equal(transition.accepted, true);
  assert.equal(transition.entry.trackId, "next-2");
  assert.deepEqual(
    transition.advancedEntries.map((item) => item.trackId),
    ["next-1", "next-2"],
  );
  assert.deepEqual(transition.remaining.map((item) => item.trackId), ["next-3"]);

  const history = appendAdvancedHistory({
    current: {
      id: "item-current",
      trackId: "current",
      context: { type: "direct", label: "Library" },
    },
    advancedEntries: transition.advancedEntries,
  });
  assert.deepEqual(history.playedStack, ["current", "next-1"]);
  assert.deepEqual(
    history.playedItems.map((item) => item.trackId),
    ["current", "next-1"],
  );

  const previousItem = history.playedItems.at(-1);
  const previousQueue = buildPreviousQueue(
    {
      id: queue[1].id,
      trackId: "next-2",
      context: queue[1].context,
    },
    transition.remaining,
  );
  assert.equal(previousItem.trackId, "next-1");
  assert.deepEqual(previousQueue.map((item) => item.trackId), [
    "next-2",
    "next-3",
  ]);
  assert.equal(
    new Set(previousQueue.map((item) => item.id)).size,
    previousQueue.length,
  );
});

test("background transition synchronization is idempotent", () => {
  const tracker = createIdempotentTransitionTracker();
  assert.equal(tracker.accept("current->next"), true);
  assert.equal(tracker.accept("current->next"), false);
  assert.equal(tracker.accept("next->later"), true);
});

test("Previous keeps a later occurrence of the current song", () => {
  const current = {
    id: "current-item",
    trackId: "current",
    context: { type: "search", label: "Search" },
  };
  const result = buildPreviousQueue(current, [entry("later"), entry("current")]);
  assert.deepEqual(result.map((item) => item.trackId), ["current", "later", "current"]);
  assert.equal(result[0].id, "current-item");
  assert.equal(result[2].id, "item-current");
});

test("Previous across repeated songs preserves each distinct queue item", () => {
  const firstA = { id: "first-a", trackId: "a" };
  const b = { id: "b", trackId: "b" };
  const secondA = { id: "second-a", trackId: "a" };
  const thirdA = { id: "third-a", trackId: "a" };
  const fromSecondA = buildPreviousQueue(secondA, [thirdA]);
  const fromB = buildPreviousQueue(b, fromSecondA);
  assert.deepEqual(fromB.map((item) => item.id), ["b", "second-a", "third-a"]);
  assert.equal(firstA.id, "first-a");
});

test("A to B to C history pops back through B and then A exactly once", () => {
  const afterB = appendAdvancedHistory({
    current: { id: "item-a", trackId: "a" },
    advancedEntries: [{ id: "item-b", trackId: "b" }],
  });
  const afterC = appendAdvancedHistory({
    current: { id: "item-b", trackId: "b" },
    advancedEntries: [{ id: "item-c", trackId: "c" }],
    playedStack: afterB.playedStack,
    playedItems: afterB.playedItems,
  });

  assert.deepEqual(afterC.playedStack, ["a", "b"]);
  const firstPrevious = afterC.playedItems.at(-1);
  const secondPrevious = afterC.playedItems.slice(0, -1).at(-1);
  assert.equal(firstPrevious.trackId, "b");
  assert.equal(secondPrevious.trackId, "a");
  assert.equal(new Set(afterC.playedItems.map((item) => item.id)).size, 2);
});

test("foreground and remote Previous use the same restart-then-history semantics", () => {
  const decide = (positionMs, hasHistory = true) =>
    selectPreviousAction({ positionMs, hasHistory, restartThresholdMs: 4000 });

  assert.equal(decide(4001), "restart-current");
  assert.equal(decide(0), "previous-track");
  assert.equal(decide(3999), "previous-track");
  assert.equal(decide(0, false), "restart-current");
});

test("native auth errors are non-retryable while network errors remain retryable", () => {
  assert.deepEqual(
    classifyPlaybackError({ code: "source", message: "Response code 401" }),
    {
      code: "AUTHENTICATION_REQUIRED",
      kind: "authentication",
      retryable: false,
    },
  );
  assert.equal(
    classifyPlaybackError({ code: "network", message: "offline" }).retryable,
    true,
  );
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

test("generated queue refills again on a later threshold crossing", async () => {
  let request = 0;
  const fixture = coordinatorFixture({
    queueIds: ["queued-0", "queued-1", "queued-2"],
    smartResult: () => {
      request += 1;
      return Array.from({ length: 30 }, (_, index) =>
        playable(`refill-${request}-${index}`),
      );
    },
  });
  assert.equal(fixture.coordinator.constants.refillThreshold, 3);
  assert.equal(await fixture.coordinator.refill(), true);
  assert.equal(fixture.state.smartCalls.length, 1);
  assert.equal(fixture.state.entries.length, DEFAULT_QUEUE_TARGET);

  fixture.state.entries = fixture.state.entries.slice(-3);
  assert.equal(await fixture.coordinator.refill(), true);
  assert.equal(fixture.state.smartCalls.length, 2);
  assert.equal(fixture.state.entries.length, DEFAULT_QUEUE_TARGET);
});

test("ordinary context keeps its suffix, session history, and item IDs through repeated continuation", async () => {
  let request = 0;
  const fixture = coordinatorFixture({
    currentTrackId: "search-current",
    queueIds: ["search-next-1", "search-next-2", "search-next-3", "search-next-4"],
    recentTrackIds: ["old-session-previous"],
    smartResult: () => {
      request += 1;
      return Array.from({ length: 30 }, (_, index) =>
        playable(`continuation-${request}-${index}`));
    },
  });
  const { state, coordinator } = fixture;
  const originalIds = state.entries.map((item) => item.id);
  const sessionHistory = state.recentTrackIds;
  assert.equal(await coordinator.refill(), false);
  assert.deepEqual(state.entries.map((item) => item.trackId), [
    "search-next-1", "search-next-2", "search-next-3", "search-next-4",
  ]);
  state.entries.shift();
  assert.equal(await coordinator.refill(), true);
  assert.deepEqual(state.entries.slice(0, 3).map((item) => item.trackId), [
    "search-next-2", "search-next-3", "search-next-4",
  ]);
  assert.deepEqual(state.entries.slice(0, 3).map((item) => item.id), originalIds.slice(1));
  assert.equal(state.entries[3].context.type, "smart_shuffle");
  assert.equal(state.entries.length, DEFAULT_QUEUE_TARGET);
  while (state.entries.length > 3) {
    const next = state.entries.shift();
    state.currentTrackId = next.trackId;
    state.recentTrackIds.push(next.trackId);
  }
  assert.ok(state.currentTrackId.startsWith("continuation-1-"));
  assert.equal(await coordinator.refill(), true);
  assert.equal(state.smartCalls.length, 2);
  assert.equal(state.entries.length, DEFAULT_QUEUE_TARGET);
  assert.ok(state.entries.some((item) => item.trackId.startsWith("continuation-2-")));
  assert.equal(state.recentTrackIds, sessionHistory);
  assert.equal(state.recentTrackIds[0], "old-session-previous");
});

test("a new three-successor context immediately expands the logical queue to target", async () => {
  const traces = [];
  const fixture = coordinatorFixture({
    currentTrackId: "home-selected",
    queueIds: ["home-next-1", "home-next-2", "home-next-3"],
    trace: (event, details) => traces.push({ event, details }),
  });
  const originalIds = fixture.state.entries.map((item) => item.id);
  assert.equal(await fixture.coordinator.refill({ force: true }), true);
  assert.equal(fixture.state.smartCalls.length, 1);
  assert.equal(fixture.state.smartCalls[0].count, DEFAULT_QUEUE_TARGET - 3);
  assert.equal(fixture.state.entries.length, DEFAULT_QUEUE_TARGET);
  assert.deepEqual(fixture.state.entries.slice(0, 3).map((item) => item.id), originalIds);
  assert.deepEqual(traces.map((item) => item.event), [
    "refill trigger", "refill requested", "recommendation result", "queue after refill",
  ]);
  assert.equal(traces[1].details.count, 27);
  assert.equal(traces[3].details.queueSize, 30);
});

test("a new context with more than the threshold still fills toward 30", async () => {
  const fixture = coordinatorFixture({
    currentTrackId: "search-selected",
    queueIds: Array.from({ length: 7 }, (_, index) => `search-next-${index}`),
  });
  const suffix = fixture.state.entries.map((item) => item.id);
  assert.equal(await fixture.coordinator.refill({ force: true }), true);
  assert.equal(fixture.state.smartCalls[0].count, 23);
  assert.deepEqual(fixture.state.entries.slice(0, 7).map((item) => item.id), suffix);
  assert.equal(fixture.state.entries.length, 30);
});

test("a forced new-context fill survives an older in-flight refill", async () => {
  let resolveOld;
  let calls = 0;
  const fixture = coordinatorFixture({
    queueIds: ["old-next"],
    smartResult: () => ++calls === 1
      ? new Promise((resolve) => { resolveOld = resolve; })
      : Array.from({ length: 30 }, (_, index) => playable(`new-${index}`)),
  });
  const old = fixture.coordinator.refill();
  fixture.coordinator.invalidate();
  fixture.state.currentTrackId = "new-current";
  fixture.state.entries = Array.from({ length: 6 }, (_, index) => entry(`context-${index}`));
  const fill = fixture.coordinator.refill({ force: true });
  resolveOld([playable("stale")]);
  assert.equal(await old, false);
  assert.equal(await fill, true);
  assert.equal(fixture.state.entries.length, DEFAULT_QUEUE_TARGET);
  assert.deepEqual(fixture.state.entries.slice(0, 6).map((item) => item.trackId),
    Array.from({ length: 6 }, (_, index) => `context-${index}`));
  assert.equal(calls, 2);
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

test("queued-track selection invalidates a pending Smart Shuffle result", async () => {
  const requests = createRecommendationRequestCoordinator();
  const token = requests.begin("smart");
  let selected = "queued-track";
  requests.invalidate();
  await Promise.resolve();
  if (requests.isCurrent(token)) selected = "stale-recommendation";
  assert.equal(selected, "queued-track");
});

test("context switch prevents an old refill from appending", async () => {
  let resolveOld;
  const pending = new Promise((resolve) => { resolveOld = resolve; });
  const fixture = coordinatorFixture({ smartResult: () => pending });
  const oldRefill = fixture.coordinator.refill();
  fixture.state.entries = [entry("new-context")];
  fixture.coordinator.invalidate();
  resolveOld([playable("old-context")]);
  assert.equal(await oldRefill, false);
  assert.deepEqual(fixture.state.entries.map((item) => item.trackId), ["new-context"]);
});

test("a new low context replaces an older in-flight continuation", async () => {
  let resolveOld;
  let calls = 0;
  const fixture = coordinatorFixture({
    queueIds: ["old-suffix"],
    smartResult: () => ++calls === 1
      ? new Promise((resolve) => { resolveOld = resolve; })
      : [playable("new-recommendation")],
  });
  const old = fixture.coordinator.refill();
  fixture.coordinator.invalidate();
  fixture.state.currentTrackId = "new-current";
  fixture.state.entries = [entry("new-suffix")];
  const current = fixture.coordinator.refill();
  resolveOld([playable("old-recommendation")]);
  assert.equal(await old, false);
  assert.equal(await current, true);
  assert.deepEqual(fixture.state.entries.map((item) => item.trackId), [
    "new-suffix", "new-recommendation",
  ]);
  assert.equal(calls, 2);
});

test("background wait joins an existing refill without starting a request", async () => {
  let resolveRequest;
  const request = new Promise((resolve) => {
    resolveRequest = resolve;
  });
  const fixture = coordinatorFixture({ smartResult: () => request });

  assert.equal(await fixture.coordinator.waitForPending(), false);
  assert.equal(fixture.state.smartCalls.length, 0);

  const refill = fixture.coordinator.refill();
  const backgroundWait = fixture.coordinator.waitForPending();
  assert.equal(fixture.state.smartCalls.length, 1);
  resolveRequest([playable("ready-before-background")]);
  assert.equal(await backgroundWait, true);
  assert.equal(await refill, true);
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
  assert.equal(await fixture.coordinator.waitForPending(), true);
  assert.equal(fixture.state.smartCalls.length, 2);
  assert.deepEqual(fixture.state.entries.map((item) => item.trackId), ["fresh-direct"]);
});

test("queue navigation waits for stale refill then appends only the current generation", async () => {
  let resolveStale;
  let calls = 0;
  const fixture = coordinatorFixture({
    queueIds: ["old-next"],
    smartResult: () => {
      calls += 1;
      return calls === 1
        ? new Promise((resolve) => { resolveStale = resolve; })
        : [playable("fresh-next")];
    },
  });
  const stale = fixture.coordinator.refill();
  fixture.coordinator.invalidate();
  fixture.state.currentTrackId = "tapped-item";
  fixture.state.entries = [];
  const replacement = fixture.coordinator.refill({ emergency: true, force: true });
  const duplicateCheck = fixture.coordinator.refill();
  assert.equal(fixture.state.smartCalls.length, 1);
  resolveStale([playable("stale-next")]);
  assert.equal(await stale, false);
  assert.equal(await replacement, true);
  assert.equal(await duplicateCheck, true);
  assert.deepEqual(fixture.state.entries.map((item) => item.trackId), ["fresh-next"]);
  assert.equal(fixture.state.smartCalls.length, 2);
  assert.equal(await fixture.coordinator.waitForPending(), false);
});

test("last-item Next recovers from an invalidated refill before stopping", async () => {
  let resolveStale;
  let calls = 0;
  const fixture = coordinatorFixture({
    smartResult: () => ++calls === 1
      ? new Promise((resolve) => { resolveStale = resolve; })
      : [playable("successor")],
  });
  const stale = fixture.coordinator.refill();
  fixture.coordinator.invalidate();
  let pauses = 0;
  let advanced = null;
  const next = runExplicitNext({
    hasLogicalSuccessor: () => fixture.state.entries.length > 0,
    reconcile: async () => true,
    advance: async () => {
      advanced = fixture.state.entries.shift()?.trackId;
      return Boolean(advanced);
    },
    emergencyRefill: () => fixture.coordinator.refill({ emergency: true, force: true }),
    pauseAtExhaustion: async () => { pauses += 1; },
  });
  resolveStale([playable("stale-successor")]);
  assert.equal(await stale, false);
  assert.equal(await next, true);
  assert.equal(advanced, "successor");
  assert.equal(pauses, 0);
  assert.equal(calls, 2);
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
    queueIds: Array.from({ length: 3 }, (_, index) => `queued-${index}`),
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
