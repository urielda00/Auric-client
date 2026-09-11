function createLikeMutationCoordinator({
  getLikedIds,
  setLikedIds,
  mutate,
  onPending,
}) {
  const pending = new Map();
  return {
    toggle(trackId) {
      if (pending.has(trackId)) return pending.get(trackId);
      const previous = [...getLikedIds()];
      const shouldLike = !previous.includes(trackId);
      const optimistic = shouldLike
        ? [trackId, ...previous]
        : previous.filter((id) => id !== trackId);
      setLikedIds(optimistic);
      onPending?.(trackId, true);
      const operation = Promise.resolve()
        .then(() => mutate(trackId, shouldLike))
        .then(() => optimistic)
        .catch((error) => {
          if (pending.get(trackId) === operation) {
            const current = getLikedIds();
            if (shouldLike) {
              setLikedIds(current.filter((id) => id !== trackId));
            } else {
              const concurrent = current.filter((id) => !previous.includes(id));
              setLikedIds([...concurrent, ...previous]);
            }
          }
          throw error;
        })
        .finally(() => {
          if (pending.get(trackId) === operation) {
            pending.delete(trackId);
            onPending?.(trackId, false);
          }
        });
      pending.set(trackId, operation);
      return operation;
    },
    isPending(trackId) {
      return pending.has(trackId);
    },
  };
}

module.exports = { createLikeMutationCoordinator };
