const OPEN_QUEUE_THRESHOLDS = {
  distance: 28,
  velocity: 500,
  minimumFlickDistance: 12,
  horizontalTravel: 32,
  verticalDominance: 1.12,
};
const DISMISS_QUEUE_THRESHOLDS = {
  distance: 22,
  velocity: 425,
  minimumFlickDistance: 11,
  horizontalTravel: 40,
  verticalDominance: 1.08,
};

function isIntentionalVerticalSwipe({
  translationX,
  directedDistance,
  directedVelocity,
  thresholds,
}) {
  const horizontal = Math.abs(translationX);
  const isClearlyVertical =
    directedDistance > horizontal * thresholds.verticalDominance;
  const hasIntent =
    directedDistance >= thresholds.distance ||
    (directedDistance >= thresholds.minimumFlickDistance &&
      directedVelocity >= thresholds.velocity);

  return (
    horizontal <= thresholds.horizontalTravel &&
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
    thresholds: OPEN_QUEUE_THRESHOLDS,
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
    thresholds: DISMISS_QUEUE_THRESHOLDS,
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
