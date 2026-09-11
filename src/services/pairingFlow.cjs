function createPairingFlow({ authSession, pairRequest }) {
  let requestGeneration = 0;
  let inFlightPairing = null;

  return {
    cancel() {
      requestGeneration += 1;
    },
    pair(code, displayLabel) {
      if (inFlightPairing) return inFlightPairing;

      const generation = ++requestGeneration;
      inFlightPairing = (async () => {
        const response = await pairRequest(code, displayLabel);
        if (generation !== requestGeneration) return { stale: true };
        await authSession.saveToken(response.token);
        if (generation !== requestGeneration) {
          await authSession.clearIfCurrent(response.token);
          return { stale: true };
        }
        return { stale: false, device: response.device };
      })().finally(() => {
        inFlightPairing = null;
      });

      return inFlightPairing;
    },
  };
}

module.exports = { createPairingFlow };
