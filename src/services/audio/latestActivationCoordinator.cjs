function createLatestActivationCoordinator() {
  let sequence = 0;
  let pending = null;
  let committedBaseline = null;
  let projectionRequested = false;

  function isCurrent(token, isNativeGenerationCurrent = () => true) {
    return Boolean(
      token &&
        pending === token &&
        token.sequence === sequence &&
        (token.generation === null ||
          isNativeGenerationCurrent(token.generation)),
    );
  }

  function commitAndTakeProjectionRequest(
    token,
    isNativeGenerationCurrent,
  ) {
    if (!isCurrent(token, isNativeGenerationCurrent)) {
      return { committed: false, projectionRequested: false };
    }
    const shouldProject = projectionRequested;
    pending = null;
    committedBaseline = null;
    projectionRequested = false;
    return { committed: true, projectionRequested: shouldProject };
  }

  return {
    begin(captureBaseline) {
      if (committedBaseline === null) {
        committedBaseline = captureBaseline();
      }
      const token = {
        sequence: ++sequence,
        generation: null,
      };
      pending = token;
      return { token, baseline: committedBaseline };
    },

    attachGeneration(token, generation) {
      if (pending !== token || token.sequence !== sequence) return false;
      token.generation = generation;
      return true;
    },

    isCurrent,

    isPendingGeneration(generation) {
      return Boolean(
        pending &&
          (generation === undefined ||
            generation === null ||
            pending.generation === generation),
      );
    },

    hasUncommittedSelection() {
      return committedBaseline !== null;
    },

    requestProjection() {
      if (!pending) return true;
      projectionRequested = true;
      return false;
    },

    commitAndTakeProjectionRequest,

    commit(token, isNativeGenerationCurrent) {
      return commitAndTakeProjectionRequest(
        token,
        isNativeGenerationCurrent,
      ).committed;
    },

    fail(token, isNativeGenerationCurrent) {
      if (!isCurrent(token, isNativeGenerationCurrent)) return false;
      pending = null;
      projectionRequested = false;
      // Keep the last committed baseline. A failed optimistic selection remains
      // retryable without becoming played history or replacing the real session.
      return true;
    },

    invalidate() {
      sequence += 1;
      pending = null;
      committedBaseline = null;
      projectionRequested = false;
    },
  };
}

module.exports = { createLatestActivationCoordinator };
