function createPairingFlow({ authSession, pairRequest }) {
  let requestGeneration = 0;

  return {
    cancel() {
      requestGeneration += 1;
    },
    async pair(code, displayLabel) {
      const generation = ++requestGeneration;
      const response = await pairRequest(code, displayLabel);
      if (generation !== requestGeneration) return { stale: true };
      await authSession.saveToken(response.token);
      if (generation !== requestGeneration) {
        await authSession.clearIfCurrent(response.token);
        return { stale: true };
      }
      return { stale: false, device: response.device };
    },
  };
}

module.exports = { createPairingFlow };
