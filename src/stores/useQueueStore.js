import { create } from 'zustand';
import { queueService } from '../services/queueService';

const queueContext = (type, label) => ({ type, label });

/** Local upcoming queue with source context retained for each Track. */
export const useQueueStore = create((set, get) => ({
  ids: [],
  contexts: {},
  hydrated: false,

  async hydrate() {
    const state = await queueService.getQueueState();
    set({ ...state, hydrated: true });
  },

  _persist(ids, contexts) {
    queueService.setQueueState({ ids, contexts });
  },

  setQueue(ids, contexts = {}) {
    set({ ids, contexts });
    get()._persist(ids, contexts);
  },

  getContext(id) {
    return get().contexts[id] || queueContext('manual_queue', 'Queue');
  },

  enqueueNext(id, context = queueContext('play_next', 'Play Next')) {
    const ids = [id, ...get().ids.filter((trackId) => trackId !== id)];
    const contexts = { ...get().contexts, [id]: context };
    get().setQueue(ids, contexts);
  },

  enqueueEnd(id, context = queueContext('manual_queue', 'Queue')) {
    const ids = [...get().ids.filter((trackId) => trackId !== id), id];
    const contexts = { ...get().contexts, [id]: context };
    get().setQueue(ids, contexts);
  },

  removeAt(index) {
    const id = get().ids[index];
    const ids = get().ids.filter((_, itemIndex) => itemIndex !== index);
    const contexts = { ...get().contexts };
    if (id) delete contexts[id];
    get().setQueue(ids, contexts);
  },

  removeId(id) {
    const ids = get().ids.filter((trackId) => trackId !== id);
    const contexts = { ...get().contexts };
    delete contexts[id];
    get().setQueue(ids, contexts);
  },

  move(from, to) {
    const ids = [...get().ids];
    if (from < 0 || from >= ids.length || to < 0 || to >= ids.length) return;
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    get().setQueue(ids, get().contexts);
  },

  shiftEntry() {
    const [id, ...ids] = get().ids;
    if (!id) return null;
    const context = get().getContext(id);
    const contexts = { ...get().contexts };
    delete contexts[id];
    get().setQueue(ids, contexts);
    return { id, context };
  },

  shift() {
    return get().shiftEntry()?.id || null;
  },

  clear() {
    get().setQueue([], {});
  },

  setFrom(ids, context = queueContext('manual_queue', 'Queue')) {
    get().setQueue(
      ids,
      Object.fromEntries(ids.map((id) => [id, context])),
    );
  },
}));

export default useQueueStore;
