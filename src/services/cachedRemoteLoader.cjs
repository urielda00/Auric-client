function createCachedRemoteLoader({ loadRemote, loadCache, saveCache }) {
  return {
    async loadCached() {
      const value = await loadCache();
      return value == null ? null : { value, cached: true };
    },
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
