const DISTANCE_THRESHOLD = 28;
const VELOCITY_THRESHOLD = 500;
const MIN_VELOCITY_DISTANCE = 12;
const MAX_HORIZONTAL_TRAVEL = 32;
const VERTICAL_DOMINANCE = 1.12;

function isIntentionalVerticalSwipe({
  translationX,
  directedDistance,
  directedVelocity,
}) {
  const horizontal = Math.abs(translationX);
  const isClearlyVertical = directedDistance > horizontal * VERTICAL_DOMINANCE;
  const hasIntent =
    directedDistance >= DISTANCE_THRESHOLD ||
    (directedDistance >= MIN_VELOCITY_DISTANCE &&
      directedVelocity >= VELOCITY_THRESHOLD);

  return (
    horizontal <= MAX_HORIZONTAL_TRAVEL &&
    directedDistance > 0 &&
    isClearlyVertical &&
    hasIntent
  );
}

function shouldOpenQueueFromSwipe({
  translationX = 0,
  translationY = 0,
  velocityY = 0,
} = {}) {
  return isIntentionalVerticalSwipe({
    translationX,
    directedDistance: -translationY,
    directedVelocity: -velocityY,
  });
}

function shouldDismissQueueFromSwipe({
  translationX = 0,
  translationY = 0,
  velocityY = 0,
} = {}) {
  return isIntentionalVerticalSwipe({
    translationX,
    directedDistance: translationY,
    directedVelocity: velocityY,
  });
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

function createQueueDismissReleaseHandler(dismissQueue) {
  return (translationX, translationY, velocityY) => {
    if (
      shouldDismissQueueFromSwipe({ translationX, translationY, velocityY })
    ) {
      dismissQueue();
      return true;
    }
    return false;
  };
}

module.exports = {
  createQueueDismissReleaseHandler,
  createQueueSwipeReleaseHandler,
  shouldDismissQueueFromSwipe,
  shouldOpenQueueFromSwipe,
};
