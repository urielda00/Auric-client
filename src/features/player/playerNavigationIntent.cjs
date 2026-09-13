function createPlayerNavigationIntentCoordinator() {
  let sequence = 0;
  const listeners = new Set();

  return {
    request() {
      const intent = Object.freeze({
        type: "open-full-player",
        sequence: ++sequence,
      });
      for (const listener of listeners) listener(intent);
      return intent;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getSequence() {
      return sequence;
    },
  };
}

function createPlayerNavigationIntentConsumer({ navigate }) {
  let lastSequence = 0;
  let playerRouteVisible = false;
  let navigationPending = false;

  return {
    syncRoute(pathname) {
      playerRouteVisible = pathname === "/player";
      if (playerRouteVisible) navigationPending = false;
    },

    consume(intent) {
      if (!intent || intent.sequence <= lastSequence) return false;
      lastSequence = intent.sequence;
      if (playerRouteVisible || navigationPending) return false;
      navigationPending = true;
      navigate();
      return true;
    },

    clearPending() {
      navigationPending = false;
    },
  };
}

const playerNavigationIntents = createPlayerNavigationIntentCoordinator();

function notifyExplicitPlaybackSelection(
  activated,
  request = () => playerNavigationIntents.request(),
) {
  if (!activated) return false;
  request();
  return true;
}

module.exports = {
  createPlayerNavigationIntentConsumer,
  createPlayerNavigationIntentCoordinator,
  notifyExplicitPlaybackSelection,
  playerNavigationIntents,
};
