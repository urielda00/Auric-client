function createLatestSearchRunner(search, delayMs = 300) {
  let generation = 0;
  let timer = null;
  let controller = null;

  return {
    run(query, handlers) {
      generation += 1;
      const current = generation;
      if (timer) clearTimeout(timer);
      controller?.abort();
      controller = new AbortController();
      handlers.onScheduled?.();
      timer = setTimeout(async () => {
        handlers.onStart?.();
        try {
          const results = await search(query, { signal: controller.signal });
          if (current === generation) handlers.onSuccess?.(results);
        } catch (error) {
          if (current === generation && !controller.signal.aborted) handlers.onError?.(error);
        }
      }, delayMs);
    },
    cancel() {
      generation += 1;
      if (timer) clearTimeout(timer);
      controller?.abort();
    },
  };
}

module.exports = { createLatestSearchRunner };
