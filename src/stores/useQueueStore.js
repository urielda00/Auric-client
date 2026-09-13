import { create } from "zustand";
import { queueService } from "../services/queueService";
import { generateUuid } from "../utils/id";

const {
  appendUniqueEntries,
  moveTrackToFront,
} = require("../services/playbackQueuePolicy.cjs");
const {
  moveEntryRelative,
  removeEntryById,
} = require("../services/queueEntryPolicy.cjs");

const queueContext = (type, label) => ({ type, label });
let persistenceHandler = null;
let mutationHandler = null;
let projectionHandler = null;

export function setQueuePersistenceHandler(handler) {
  persistenceHandler = handler;
}

export function setQueueMutationHandler(handler) {
  mutationHandler = handler;
}

export function setQueueProjectionHandler(handler) {
  projectionHandler = handler;
}

function entry(trackId, context, id = generateUuid()) {
  return { id, trackId, context };
}

function derived(entries) {
  return {
    entries,
    ids: entries.map((item) => item.trackId),
    contexts: Object.fromEntries(
      entries.map((item) => [item.trackId, item.context]),
    ),
  };
}

/** Upcoming queue. Stable entry IDs are canonical; ids/contexts remain UI compatibility views. */
export const useQueueStore = create((set, get) => ({
  entries: [],
  ids: [],
  contexts: {},
  hydrated: false,

  async hydrate() {
    const state = await queueService.getQueueState();
    const entries = state.ids.map((trackId) =>
      entry(
        trackId,
        state.contexts[trackId] || queueContext("manual_queue", "Queue"),
      ),
    );
    set({ ...derived(entries), hydrated: true });
  },

  hydrateSnapshot(items = []) {
    const entries = items.map((item) =>
      entry(
        item.trackId,
        item.context || queueContext("manual_queue", "Queue"),
        item.id,
      ),
    );
    set({ ...derived(entries), hydrated: true });
  },

  _commit(entries, { persist = true, refill = true } = {}) {
    const state = derived(entries);
    set(state);
    queueService.setQueueState({ ids: state.ids, contexts: state.contexts });
    projectionHandler?.();
    if (persist) persistenceHandler?.();
    if (refill) mutationHandler?.();
  },

  setQueue(ids, contexts = {}, options) {
    get()._commit(
      ids.map((trackId) =>
        entry(
          trackId,
          contexts[trackId] || queueContext("manual_queue", "Queue"),
        ),
      ),
      options,
    );
  },

  replaceEntries(entries, options) {
    get()._commit(
      entries.map((item) =>
        entry(
          item.trackId,
          item.context || queueContext("manual_queue", "Queue"),
          item.id,
        ),
      ),
      options,
    );
  },

  getContext(trackId) {
    return (
      get().entries.find((item) => item.trackId === trackId)?.context ||
      queueContext("manual_queue", "Queue")
    );
  },

  enqueueNext(
    trackId,
    context = queueContext("play_next", "Play Next"),
    options,
  ) {
    const entries = moveTrackToFront(
      get().entries,
      entry(trackId, context, options?.itemId),
    );
    get()._commit(entries, options);
  },

  enqueueEnd(
    trackId,
    context = queueContext("manual_queue", "Queue"),
    options,
  ) {
    const entries = [
      ...get().entries.filter((item) => item.trackId !== trackId),
      entry(trackId, context),
    ];
    get()._commit(entries, options);
  },

  appendUnique(
    trackIds,
    context = queueContext("manual_queue", "Queue"),
    options,
  ) {
    const additions = trackIds.map((trackId) => entry(trackId, context));
    get()._commit(appendUniqueEntries(get().entries, additions), options);
  },

  removeAt(index, options) {
    get()._commit(
      get().entries.filter((_, itemIndex) => itemIndex !== index),
      options,
    );
  },

  removeEntry(entryId, options) {
    const result = removeEntryById(get().entries, entryId);
    if (!result.changed) return false;
    get()._commit(result.entries, options);
    return true;
  },

  removeId(trackId, options) {
    get()._commit(
      get().entries.filter((item) => item.trackId !== trackId),
      options,
    );
  },

  move(from, to, options) {
    const entries = [...get().entries];
    if (from < 0 || from >= entries.length || to < 0 || to >= entries.length)
      return;
    const [moved] = entries.splice(from, 1);
    entries.splice(to, 0, moved);
    get()._commit(entries, options);
  },

  moveEntry(entryId, targetEntryId, placement, options) {
    const result = moveEntryRelative(
      get().entries,
      entryId,
      targetEntryId,
      placement,
    );
    if (!result.changed) return false;
    get()._commit(result.entries, options);
    return true;
  },

  shiftEntry(options) {
    const [first, ...entries] = get().entries;
    if (!first) return null;
    get()._commit(entries, options);
    return { id: first.trackId, itemId: first.id, context: first.context };
  },

  shift(options) {
    return get().shiftEntry(options)?.id || null;
  },

  clear(options) {
    get()._commit([], options);
  },

  setFrom(ids, context = queueContext("manual_queue", "Queue"), options) {
    get()._commit(
      ids.map((trackId) => entry(trackId, context)),
      options,
    );
  },
}));

export default useQueueStore;
