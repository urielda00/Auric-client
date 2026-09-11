import { serverApi } from './serverApi';

const { createListeningApi } = require('./activityApi.cjs');

const remoteListening = serverApi ? createListeningApi(serverApi) : null;

export const listeningService = {
  enabled: remoteListening !== null,

  async start(session) {
    if (!remoteListening) return null;
    return remoteListening.start(session);
  },

  async checkpoint(session) {
    if (!remoteListening) return null;
    return remoteListening.checkpoint(session);
  },

  async end(session, endedReason) {
    if (!remoteListening) return null;
    return remoteListening.end(session, endedReason);
  },
};

export default listeningService;
