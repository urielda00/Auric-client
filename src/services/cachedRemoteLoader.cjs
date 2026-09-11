function createCachedRemoteLoader({ loadRemote, loadCache, saveCache }) {
  return {
    async load(options = {}) {
      try {
        const value = await loadRemote(options);
        await saveCache(value);
        return { value, cached: false };
      } catch (error) {
        if (options.signal?.aborted) throw error;
        const cached = await loadCache();
        if (cached != null) return { value: cached, cached: true };
        throw error;
      }
    },
  };
}

module.exports = { createCachedRemoteLoader };
