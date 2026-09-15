const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const {
  PLAYED_ROW_HEIGHT,
  createQueuePlaybackControls,
  deriveQueueTimeline,
  getQueueInitialOffset,
} = require("../src/features/queue/queueTimeline.cjs");
const {
  createQueueDismissReleaseHandler,
  createQueueSwipeReleaseHandler,
  shouldDismissQueueFromSwipe,
  shouldOpenQueueFromSwipe,
} = require("../src/features/player/queueSwipe.cjs");
const {
  bindPhysicalTransportActions,
  physicalSeekRatio,
  seekPositionFromRatio,
} = require("../src/features/player/playerUxPolicy.cjs");
const {
  createPlayerNavigationIntentConsumer,
  createPlayerNavigationIntentCoordinator,
  notifyExplicitPlaybackSelection,
} = require("../src/features/player/playerNavigationIntent.cjs");
const {
  createQueueDragCoordinator,
  moveEntryRelative,
} = require("../src/features/queue/dragReorderPolicy.cjs");
const {
  removeEntryById,
} = require("../src/services/queueEntryPolicy.cjs");

const track = (id) => ({ id, title: id, artists: ["Artist"] });
const entry = (id) => ({
  id: `item-${id}`,
  trackId: id,
  context: { type: "queue", label: "Queue" },
});

test("queue timeline composes played, current, then upcoming in chronological order", () => {
  const playedItems = [entry("a"), entry("b"), entry("c")];
  const queueEntries = [entry("e"), entry("f")];
  const tracksById = Object.fromEntries(
    ["a", "b", "c", "d", "e", "f"].map((id) => [id, track(id)]),
  );

  const timeline = deriveQueueTimeline({
    playedItems,
    currentTrackId: "d",
    currentItemId: "item-d",
    queueEntries,
    tracksById,
  });

  assert.deepEqual(
    [...timeline.played, timeline.current, ...timeline.upcoming].map(
      (item) => item.trackId,
    ),
    ["a", "b", "c", "d", "e", "f"],
  );
  assert.equal(timeline.played.at(-1).trackId, "c");
  assert.equal(timeline.current.trackId, "d");
});

test("deriving the queue is read-only and keeps timeline roles separate", () => {
  const playedItems = [entry("past")];
  const queueEntries = [entry("next"), entry("later")];
  const snapshot = structuredClone(playedItems);
  const timeline = deriveQueueTimeline({
    playedItems,
    currentTrackId: "current",
    queueEntries,
    tracksById: {
      past: track("past"),
      current: track("current"),
      next: track("next"),
      later: track("later"),
    },
  });

  assert.deepEqual(playedItems, snapshot);
  assert.equal(timeline.played[0].type, "played");
  assert.equal(timeline.current.type, "current");
  assert.deepEqual(
    timeline.upcoming.map((item) => [item.id, item.type]),
    [
      ["item-next", "upcoming"],
      ["item-later", "upcoming"],
    ],
  );
});

test("queue initial offset anchors the scroll viewport at the current row", () => {
  assert.equal(getQueueInitialOffset(0), 0);
  assert.equal(getQueueInitialOffset(1), PLAYED_ROW_HEIGHT);
  assert.equal(getQueueInitialOffset(50), 50 * PLAYED_ROW_HEIGHT);

  const timeline = deriveQueueTimeline({
    playedItems: [
      entry("cached"),
      entry("missing-from-cache"),
      entry("unavailable"),
    ],
    currentTrackId: "current",
    tracksById: {
      cached: track("cached"),
      unavailable: { ...track("unavailable"), hasMedia: false },
      current: track("current"),
    },
  });

  assert.deepEqual(
    timeline.played.map((item) => item.trackId),
    ["cached", "unavailable"],
  );
  assert.equal(
    getQueueInitialOffset(timeline.played.length),
    2 * PLAYED_ROW_HEIGHT,
  );
});

test("queue header delegates Play/Pause to the existing player toggle", () => {
  let calls = 0;
  const controls = createQueuePlaybackControls(() => {
    calls += 1;
  });
  controls.togglePlayback();
  assert.equal(calls, 1);
});

test("a deliberate upward player gesture opens the existing queue route", () => {
  const routes = [];
  const onRelease = createQueueSwipeReleaseHandler(() => routes.push("/queue"));
  assert.equal(onRelease(5, -52, -300), true);
  assert.deepEqual(routes, ["/queue"]);
  assert.equal(
    shouldOpenQueueFromSwipe({ translationY: -22, velocityY: -900 }),
    true,
  );
});

test("accepted Queue swipe navigates synchronously without a data prerequisite", () => {
  const events = [];
  const unresolvedPlaybackWork = new Promise(() => {});
  const onRelease = createQueueSwipeReleaseHandler(() =>
    events.push("navigate"),
  );

  assert.equal(onRelease(2, -28, -100), true);
  events.push("after-release");
  assert.deepEqual(events, ["navigate", "after-release"]);
  assert.ok(unresolvedPlaybackWork instanceof Promise);

  const source = readFileSync(
    join(process.cwd(), "src/features/player/FullPlayerScreen.js"),
    "utf8",
  );
  assert.match(
    source,
    /useCallback\(\(\) => router\.push\("\/queue"\), \[router\]\)/,
  );
});

test("Full Player Queue Pan is limited to the lower artwork and Queue handle", () => {
  const routes = [];
  const releaseFromArtwork = createQueueSwipeReleaseHandler(() =>
    routes.push("artwork"),
  );
  const releaseFromBackground = createQueueSwipeReleaseHandler(() =>
    routes.push("background"),
  );

  assert.equal(releaseFromArtwork(3, -40, -200), true);
  assert.equal(releaseFromBackground(0, -28, -100), true);
  assert.deepEqual(routes, ["artwork", "background"]);

  const source = readFileSync(
    join(process.cwd(), "src/features/player/FullPlayerScreen.js"),
    "utf8",
  );
  assert.match(source, /return \(\s*<View style=\{styles\.screen\}>/);
  assert.doesNotMatch(source, /gesture=\{queueSwipe\}/);
  assert.match(
    source,
    /<GestureDetector gesture=\{queueSwipeFromArtwork\}>\s*<View style=\{styles\.artQueueSwipeZone\}/,
  );
  assert.match(
    source,
    /<GestureDetector gesture=\{queueSwipeFromHandle\}>\s*<View style=\{styles\.queuePullZone\}/,
  );
  assert.match(
    source,
    /artQueueSwipeZone:\s*\{[\s\S]*?bottom: 0,[\s\S]*?height: "50%"/,
  );
});

test("Full Player controls and SeekBar are outside Queue Pan ownership", () => {
  const source = readFileSync(
    join(process.cwd(), "src/features/player/FullPlayerScreen.js"),
    "utf8",
  );
  assert.doesNotMatch(source, /controlGestures|requireExternalGestureToFail/);
  assert.match(source, /<SeekBar\s+pct=\{pct\}/);
  assert.match(source, /accessibilityLabel="Previous"[\s\S]*?onPress=\{transportActions\.left\}/);
  assert.match(source, /<Pressable onPress=\{toggle\} style=\{styles\.playBtn\}>/);
  assert.match(source, /accessibilityLabel="Next"[\s\S]*?onPress=\{transportActions\.right\}/);

  const titleStart = source.indexOf('<View style={styles.titleRow}>');
  const progressStart = source.indexOf('<View style={styles.progressZone}>');
  const transportStart = source.indexOf("styles.transport");
  for (const region of [titleStart, progressStart, transportStart]) {
    assert.ok(region >= 0);
    const nearby = source.slice(region, region + 1400);
    assert.doesNotMatch(nearby, /queueSwipeFromArtwork/);
  }

  const routes = [];
  const release = createQueueSwipeReleaseHandler(() => routes.push("queue"));
  assert.equal(release(0, 0, 0), false);
  assert.deepEqual(routes, []);
});

test("tap, small movement, downward movement, and horizontal gestures do not open queue", () => {
  const routes = [];
  const onRelease = createQueueSwipeReleaseHandler(() => routes.push("/queue"));

  assert.equal(onRelease(0, 0, 0), false);
  assert.equal(onRelease(2, -12, -100), false);
  assert.equal(onRelease(0, 55, 900), false);
  assert.equal(onRelease(60, -55, -800), false);
  assert.deepEqual(routes, []);
});

test("seek uses physical left-to-right coordinates in LTR and RTL", () => {
  assert.equal(physicalSeekRatio(0, 200), 0);
  assert.equal(physicalSeekRatio(100, 200), 0.5);
  assert.equal(physicalSeekRatio(200, 200), 1);
  assert.ok(physicalSeekRatio(140, 200) > physicalSeekRatio(80, 200));

  // Locale is deliberately not an input: the same physical x gives the same ratio.
  const rtlRatio = physicalSeekRatio(140, 200);
  assert.equal(rtlRatio, 0.7);
  assert.equal(seekPositionFromRatio(rtlRatio, 100_000), 70_000);
});

test("seek clamps outside the bar and safely rejects invalid geometry/duration", () => {
  assert.equal(physicalSeekRatio(-30, 200), 0);
  assert.equal(physicalSeekRatio(260, 200), 1);
  assert.equal(physicalSeekRatio(30, 0), null);
  assert.equal(physicalSeekRatio(Number.NaN, 200), null);
  assert.equal(seekPositionFromRatio(0.5, 0), null);
  assert.equal(seekPositionFromRatio(0.5, Number.NaN), null);
});

test("physical transport always binds left to Previous and right to Next", () => {
  const calls = [];
  const actions = bindPhysicalTransportActions({
    previous: () => calls.push("previous"),
    next: () => calls.push("next"),
  });
  actions.left();
  actions.right();
  assert.deepEqual(calls, ["previous", "next"]);
});

test("Previous transport neither navigates nor keys the Full Player route by track", () => {
  const playerSource = readFileSync(
    join(process.cwd(), "src/features/player/FullPlayerScreen.js"),
    "utf8",
  );
  const storeSource = readFileSync(
    join(process.cwd(), "src/stores/usePlayerStore.js"),
    "utf8",
  );
  const previousStart = storeSource.indexOf("async previous(");
  const previous = storeSource.slice(
    previousStart,
    storeSource.indexOf("async next(", previousStart),
  );

  assert.match(
    playerSource,
    /accessibilityLabel="Previous"[\s\S]*?onPress=\{transportActions\.left\}/,
  );
  assert.doesNotMatch(playerSource, /key=\{currentTrackId\}/);
  assert.doesNotMatch(previous, /router\.|notifyExplicitPlaybackSelection/);
  assert.doesNotMatch(previous, /currentTrackId:\s*null/);
});

test("short upward distance or flick opens Queue while tiny/horizontal input does not", () => {
  assert.equal(shouldOpenQueueFromSwipe({ translationY: -28 }), true);
  assert.equal(
    shouldOpenQueueFromSwipe({ translationY: -12, velocityY: -500 }),
    true,
  );
  assert.equal(shouldOpenQueueFromSwipe({ translationY: -7 }), false);
  assert.equal(
    shouldOpenQueueFromSwipe({ translationX: 30, translationY: -28 }),
    false,
  );
  assert.equal(shouldOpenQueueFromSwipe({ translationY: 28 }), false);
});

test("Queue dismiss accepts a natural downward drag and a short fast flick", () => {
  const calls = [];
  const release = createQueueDismissReleaseHandler(() => calls.push("player"));
  assert.equal(release(2, 22, 100), true);
  assert.equal(
    shouldDismissQueueFromSwipe({ translationY: 11, velocityY: 425 }),
    true,
  );
  assert.deepEqual(calls, ["player"]);
});

test("Queue dismiss rejects tiny, horizontal, and upward movement", () => {
  assert.equal(shouldDismissQueueFromSwipe({ translationY: 6 }), false);
  assert.equal(
    shouldDismissQueueFromSwipe({ translationX: 38, translationY: 22 }),
    false,
  );
  assert.equal(shouldDismissQueueFromSwipe({ translationY: -22 }), false);
});

test("Queue top chrome owns dismissal while its virtualized timeline stays independent", () => {
  const source = readFileSync(
    join(process.cwd(), "src/features/queue/QueueScreen.js"),
    "utf8",
  );
  const detector = source.indexOf(
    '<GestureDetector gesture={queueDismissSwipe}>',
  );
  const topChrome = source.indexOf(
    '<View style={styles.topChrome}>',
    detector,
  );
  const header = source.indexOf('<View style={styles.headerRow}>', topChrome);
  const detectorEnd = source.indexOf("</GestureDetector>", topChrome);
  const timeline = source.indexOf('<FlatList', detectorEnd);

  assert.ok(detector >= 0);
  assert.ok(topChrome > detector);
  assert.ok(header > topChrome && header < detectorEnd);
  assert.ok(timeline > detectorEnd);
  assert.match(source, /topChrome:\s*\{\s*minHeight: 76/);
});

test("accepted explicit selection emits a Full Player intent immediately", () => {
  const coordinator = createPlayerNavigationIntentCoordinator();
  const intents = [];
  coordinator.subscribe((intent) => intents.push(intent));

  assert.equal(
    notifyExplicitPlaybackSelection(true, () => coordinator.request()),
    true,
  );
  assert.equal(intents.length, 1);
  assert.equal(intents[0].type, "open-full-player");
  assert.equal(intents[0].sequence, 1);

  assert.equal(
    notifyExplicitPlaybackSelection(false, () => coordinator.request()),
    false,
  );
  assert.equal(intents.length, 1);
});

test("Full Player navigation does not wait for native Ready", () => {
  const coordinator = createPlayerNavigationIntentCoordinator();
  const events = [];
  coordinator.subscribe(() => events.push("navigate"));
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });

  notifyExplicitPlaybackSelection(true, () => coordinator.request());
  events.push("loading");

  assert.deepEqual(events, ["navigate", "loading"]);
  resolveReady();
  return ready;
});

test("non-user playback transitions produce no navigation and rapid selections do not duplicate pushes", () => {
  const coordinator = createPlayerNavigationIntentCoordinator();
  const routes = [];
  const consumer = createPlayerNavigationIntentConsumer({
    navigate: () => routes.push("/player"),
  });
  coordinator.subscribe((intent) => consumer.consume(intent));

  // Natural/remote Next, restore, refill and startup do not call request().
  assert.equal(coordinator.getSequence(), 0);
  coordinator.request();
  coordinator.request();
  assert.deepEqual(routes, ["/player"]);

  consumer.syncRoute("/player");
  coordinator.request();
  assert.deepEqual(routes, ["/player"]);
});

test("rapid A, B, C selections produce one effective player route opening", () => {
  const coordinator = createPlayerNavigationIntentCoordinator();
  const routes = [];
  const consumer = createPlayerNavigationIntentConsumer({
    navigate: () => routes.push("/player"),
  });
  coordinator.subscribe((intent) => consumer.consume(intent));

  notifyExplicitPlaybackSelection(true, () => coordinator.request());
  notifyExplicitPlaybackSelection(true, () => coordinator.request());
  notifyExplicitPlaybackSelection(true, () => coordinator.request());

  assert.deepEqual(routes, ["/player"]);
});

function ids(entries) {
  return entries.map((item) => item.id);
}

function queueEntries(...entryIds) {
  return entryIds.map((id) => ({ id, trackId: `track-${id}` }));
}

function dragFixture(initialIds) {
  let entries = queueEntries(...initialIds);
  let commitCount = 0;
  const coordinator = createQueueDragCoordinator({
    getEntryIds: () => ids(entries),
    onCommit: (entryId, targetEntryId, placement) => {
      const result = moveEntryRelative(
        entries,
        entryId,
        targetEntryId,
        placement,
      );
      if (!result.changed) return false;
      entries = result.entries;
      commitCount += 1;
      return true;
    },
  });
  return {
    coordinator,
    get entries() {
      return entries;
    },
    set entries(value) {
      entries = value;
    },
    get commitCount() {
      return commitCount;
    },
  };
}

test("the same stable queue entry can be reordered repeatedly", () => {
  const fixture = dragFixture(["a", "b", "c"]);
  assert.equal(fixture.coordinator.begin("b", ids(fixture.entries)), true);
  assert.equal(fixture.coordinator.finish(2), true);
  assert.deepEqual(ids(fixture.entries), ["a", "c", "b"]);

  assert.equal(fixture.coordinator.begin("b", ids(fixture.entries)), true);
  assert.equal(fixture.coordinator.finish(0), true);
  assert.deepEqual(ids(fixture.entries), ["b", "a", "c"]);
  assert.equal(fixture.commitCount, 2);
});

test("cancel/failure clears drag state so the row can restart immediately", () => {
  const fixture = dragFixture(["a", "b", "c"]);
  fixture.coordinator.begin("b", ids(fixture.entries));
  assert.equal(fixture.coordinator.cancel(), true);
  assert.equal(fixture.coordinator.getActiveEntryId(), null);
  assert.equal(fixture.coordinator.begin("b", ids(fixture.entries)), true);
  assert.equal(fixture.coordinator.finish(0), true);
  assert.equal(fixture.coordinator.getActiveEntryId(), null);
});

test("drag commit resolves stale indexes by entry identity after refill append", () => {
  const fixture = dragFixture(["a", "b", "c"]);
  fixture.coordinator.begin("b", ids(fixture.entries));
  fixture.entries = [...fixture.entries, ...queueEntries("refill")];
  fixture.coordinator.finish(2);
  assert.deepEqual(ids(fixture.entries), ["a", "c", "b", "refill"]);
  assert.equal(fixture.commitCount, 1);
});

test("drag commit resolves the latest positions after a queue head shift", () => {
  const fixture = dragFixture(["head", "a", "b", "c"]);
  fixture.coordinator.begin("b", ids(fixture.entries));
  fixture.entries = fixture.entries.slice(1);
  fixture.coordinator.finish(3);
  assert.deepEqual(ids(fixture.entries), ["a", "c", "b"]);
  assert.equal(fixture.commitCount, 1);
});

test("a dragged entry disappearing before commit cancels without moving another row", () => {
  const fixture = dragFixture(["a", "b", "c"]);
  fixture.coordinator.begin("b", ids(fixture.entries));
  fixture.entries = fixture.entries.filter((item) => item.id !== "b");
  assert.equal(fixture.coordinator.finish(2), false);
  assert.deepEqual(ids(fixture.entries), ["a", "c"]);
  assert.equal(fixture.commitCount, 0);
  assert.equal(fixture.coordinator.getActiveEntryId(), null);
});

test("stable upcoming entry operations never include played/current timeline rows", () => {
  const timeline = deriveQueueTimeline({
    playedItems: [entry("played")],
    currentTrackId: "current",
    currentItemId: "item-current",
    queueEntries: [entry("next"), entry("later")],
    tracksById: Object.fromEntries(
      ["played", "current", "next", "later"].map((id) => [id, track(id)]),
    ),
  });
  const upcomingIds = ids(timeline.upcoming);
  assert.deepEqual(upcomingIds, ["item-next", "item-later"]);
  assert.equal(upcomingIds.includes(timeline.played[0].id), false);
  assert.equal(upcomingIds.includes(timeline.current.id), false);

  const moved = moveEntryRelative(
    timeline.upcoming,
    "item-later",
    "item-next",
    "before",
  );
  assert.deepEqual(ids(moved.entries), ["item-later", "item-next"]);

  const removed = removeEntryById(moved.entries, "item-next");
  assert.deepEqual(ids(removed.entries), ["item-later"]);
  assert.equal(removed.changed, true);
});
