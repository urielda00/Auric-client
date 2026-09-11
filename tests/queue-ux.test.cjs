const assert = require("node:assert/strict");
const test = require("node:test");

const {
  PLAYED_ROW_HEIGHT,
  createQueuePlaybackControls,
  deriveQueueTimeline,
  getQueueInitialOffset,
  getUpcomingMutationIndex,
} = require("../src/features/queue/queueTimeline.cjs");
const {
  createQueueSwipeReleaseHandler,
  shouldOpenQueueFromSwipe,
} = require("../src/features/player/queueSwipe.cjs");

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

test("deriving the queue is read-only and past items never receive queue indexes", () => {
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
  assert.equal(timeline.played[0].queueIndex, null);
  assert.equal(timeline.current.queueIndex, null);
  assert.deepEqual(
    timeline.upcoming.map((item) => item.queueIndex),
    [0, 1],
  );
  assert.equal(getUpcomingMutationIndex(timeline.upcoming, 1), 1);
  assert.equal(getUpcomingMutationIndex(timeline.upcoming, 2), -1);
});

test("queue initial offset anchors the scroll viewport at the current row", () => {
  assert.equal(getQueueInitialOffset(0), 0);
  assert.equal(getQueueInitialOffset(3), 3 * PLAYED_ROW_HEIGHT);
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

test("tap, small movement, downward movement, and horizontal gestures do not open queue", () => {
  const routes = [];
  const onRelease = createQueueSwipeReleaseHandler(() => routes.push("/queue"));

  assert.equal(onRelease(0, 0, 0), false);
  assert.equal(onRelease(2, -12, -100), false);
  assert.equal(onRelease(0, 55, 900), false);
  assert.equal(onRelease(60, -55, -800), false);
  assert.deepEqual(routes, []);
});
