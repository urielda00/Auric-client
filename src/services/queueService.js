import { loadJSON, saveJSON, STORAGE_KEYS } from './storage';

/** Persists the "upcoming" queue (track ids, current track excluded) between app launches. */
export const queueService = {
  async getQueueIds() {
    return loadJSON(STORAGE_KEYS.queue, []);
  },
  async setQueueIds(ids) {
    await saveJSON(STORAGE_KEYS.queue, ids);
  },
};

export default queueService;
