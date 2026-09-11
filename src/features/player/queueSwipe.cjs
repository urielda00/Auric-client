const DISTANCE_THRESHOLD = 48;
const VELOCITY_THRESHOLD = 700;
const MIN_VELOCITY_DISTANCE = 18;
const MAX_HORIZONTAL_TRAVEL = 28;
const VERTICAL_DOMINANCE = 1.25;

function shouldOpenQueueFromSwipe({
  translationX = 0,
  translationY = 0,
  velocityY = 0,
} = {}) {
  const horizontal = Math.abs(translationX);
  const upward = -translationY;
  const isClearlyVertical = upward > horizontal * VERTICAL_DOMINANCE;
  const hasUpwardIntent =
    upward >= DISTANCE_THRESHOLD ||
    (upward >= MIN_VELOCITY_DISTANCE && velocityY <= -VELOCITY_THRESHOLD);

  return (
    horizontal <= MAX_HORIZONTAL_TRAVEL &&
    translationY < 0 &&
    isClearlyVertical &&
    hasUpwardIntent
  );
}

function createQueueSwipeReleaseHandler(openQueue) {
  return (translationX, translationY, velocityY) => {
    if (
      shouldOpenQueueFromSwipe({ translationX, translationY, velocityY })
    ) {
      openQueue();
      return true;
    }
    return false;
  };
}

module.exports = {
  createQueueSwipeReleaseHandler,
  shouldOpenQueueFromSwipe,
};
