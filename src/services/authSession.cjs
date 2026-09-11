const AUTH_TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,200}$/;

function createAuthSession({ secureStore, useMocks = false }) {
  let token = null;
  let hydrated = useMocks;
  let generation = 0;
  let hydrationPromise = null;
  let storageQueue = Promise.resolve();
  const listeners = new Set();

  const snapshot = () => ({
    hydrated,
    authenticated: useMocks || token !== null,
    mock: useMocks,
  });
  const notify = () => listeners.forEach((listener) => listener(snapshot()));
  const enqueueStorage = (operation) => {
    const result = storageQueue.catch(() => {}).then(operation);
    storageQueue = result.catch(() => {});
    return result;
  };

  return {
    snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getToken() {
      return token;
    },
    async hydrate() {
      if (hydrated) return snapshot();
      if (!hydrationPromise) {
        const startedGeneration = generation;
        hydrationPromise = (async () => {
          const stored = await secureStore.getToken();
          if (generation === startedGeneration) {
            token =
              typeof stored === "string" && AUTH_TOKEN_PATTERN.test(stored)
                ? stored
                : null;
            hydrated = true;
            notify();
          }
          return snapshot();
        })().finally(() => {
          hydrationPromise = null;
        });
      }
      return hydrationPromise;
    },
    async saveToken(nextToken) {
      if (!AUTH_TOKEN_PATTERN.test(nextToken))
        throw new Error("Invalid device token");
      const operationGeneration = ++generation;
      await enqueueStorage(() => secureStore.setToken(nextToken));
      if (operationGeneration !== generation) return false;
      token = nextToken;
      hydrated = true;
      notify();
      return true;
    },
    async clearToken() {
      const operationGeneration = ++generation;
      token = null;
      hydrated = true;
      notify();
      await enqueueStorage(() => secureStore.setToken(null));
      return operationGeneration === generation;
    },
    async clearIfCurrent(failedToken) {
      if (token !== failedToken) return false;
      await this.clearToken();
      return true;
    },
  };
}

module.exports = { createAuthSession };
