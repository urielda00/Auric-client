import { create } from 'zustand';
import { queueService } from '../services/queueService';

/**
 * Queue slice: the "up next" list of track ids. The current track is never a member of
 * this list — playing a track always removes it from here first (mirrors the approved
 * design's queue model exactly).
 */
export const useQueueStore = create((set, get) => ({
  ids: [],
  hydrated: false,

  async hydrate() {
    const ids = await queueService.getQueueIds();
    set({ ids, hydrated: true });
  },

  _persist(ids) {
    queueService.setQueueIds(ids);
  },

  setQueue(ids) {
    set({ ids });
    get()._persist(ids);
  },

  /** Adds to the very front — "Play Next". */
  enqueueNext(id) {
    const ids = [id, ...get().ids.filter((x) => x !== id)];
    get().setQueue(ids);
  },

  /** Adds to the end — "Add to queue". */
  enqueueEnd(id) {
    const ids = [...get().ids.filter((x) => x !== id), id];
    get().setQueue(ids);
  },

  removeAt(index) {
    const ids = get().ids.filter((_, i) => i !== index);
    get().setQueue(ids);
  },

  removeId(id) {
    const ids = get().ids.filter((x) => x !== id);
    get().setQueue(ids);
  },

  move(from, to) {
    const ids = [...get().ids];
    if (from < 0 || from >= ids.length || to < 0 || to >= ids.length) return;
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    get().setQueue(ids);
  },

  /** Pops the head of the queue (used by the player when a track ends/skips). */
  shift() {
    const ids = get().ids;
    if (!ids.length) return null;
    const [head, ...rest] = ids;
    get().setQueue(rest);
    return head;
  },

  clear() {
    get().setQueue([]);
  },

  /** Replaces the whole queue, e.g. starting Smart Shuffle or Liked Songs playback. */
  setFrom(ids) {
    get().setQueue(ids);
  },
}));

export default useQueueStore;
