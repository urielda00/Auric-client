import { apiConfig } from "./apiConfig";
import { loadJSON, saveJSON, STORAGE_KEYS } from "./storage";
import { serverApi } from "./serverApi";
import { generateUuid } from "../utils/id";

const { createPlaybackStateApi } = require("./playbackStateApi.cjs");
const {
  createPlaybackSyncCoordinator,
} = require("./playbackSyncCoordinator.cjs");

const api = serverApi ? createPlaybackStateApi(serverApi) : null;

export const playbackStateService = createPlaybackSyncCoordinator({
  api,
  enabled: apiConfig.useServer,
  trace: (event, details) => {
    if (typeof __DEV__ !== "undefined" && __DEV__) {
      console.debug("[AuricPlaybackPersistence]", { event, timestamp: Date.now(), ...details });
    }
  },
  storage: {
    load: async () => {
      const snapshot = await loadJSON(STORAGE_KEYS.playbackSnapshot, null);
      if (snapshot) return snapshot;
      const [session, queue] = await Promise.all([
        loadJSON(STORAGE_KEYS.currentTrack, null),
        loadJSON(STORAGE_KEYS.queue, []),
      ]);
      const ids = Array.isArray(queue)
        ? queue
        : Array.isArray(queue?.ids)
          ? queue.ids
          : [];
      const contexts =
        !Array.isArray(queue) && queue?.contexts ? queue.contexts : {};
      if (!session?.trackId && !ids.length) return null;
      return {
        revision: 0,
        current: session?.trackId
          ? {
              id: generateUuid(),
              trackId: session.trackId,
              context: session.context || { type: "resume", label: "Resumed" },
            }
          : null,
        positionMs: session?.positionMs || 0,
        shuffleMode: session?.shuffleMode || null,
        upcoming: ids.map((trackId) => ({
          id: generateUuid(),
          trackId,
          context: contexts[trackId] || {
            type: "manual_queue",
            label: "Queue",
          },
        })),
        played: [],
        updatedAtMs: 0,
      };
    },
    save: (snapshot) => saveJSON(STORAGE_KEYS.playbackSnapshot, snapshot),
  },
});

export default playbackStateService;
