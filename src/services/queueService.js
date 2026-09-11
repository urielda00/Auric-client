import { loadJSON, saveJSON, STORAGE_KEYS } from './storage';

/** Persists the "upcoming" queue (track ids, current track excluded) between app launches. */
export const queueService = {
  async getQueueState() {
    const stored = await loadJSON(STORAGE_KEYS.queue, []);
    if (Array.isArray(stored)) {
      return {
        ids: stored,
        contexts: Object.fromEntries(
          stored.map((id) => [id, { type: 'manual_queue', label: 'Queue' }]),
        ),
      };
    }
    return {
      ids: Array.isArray(stored?.ids) ? stored.ids : [],
      contexts:
        stored?.contexts && typeof stored.contexts === 'object'
          ? stored.contexts
          : {},
    };
  },
  async getQueueIds() {
    return (await this.getQueueState()).ids;
  },
  async setQueueIds(ids) {
    await this.setQueueState({ ids, contexts: {} });
  },
  async setQueueState(state) {
    await saveJSON(STORAGE_KEYS.queue, state);
  },
};

export default queueService;
