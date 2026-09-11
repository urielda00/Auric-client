import { MOCK_TRACKS } from "../mocks/tracks";
import { loadJSON, saveJSON, STORAGE_KEYS } from "./storage";
import { generateId } from "../utils/id";
import { apiConfig } from "./apiConfig";
import { authSession } from "./authSession";
import { serverApi } from "./serverApi";

const { mapTrackDto } = require("./trackMapper.cjs");
const { createTrackStreamSource } = require("./audio/streamSource.cjs");

/**
 * The library data source. Every other service reads tracks through here.
 * Server-backed library/search reads live beside the existing mock catalogue used by
 * deferred Home/recommendation flows. Screens and other services never import mocks
 * directly, and setting EXPO_PUBLIC_AURIC_USE_MOCKS keeps isolated UI work available.
 */

let library = apiConfig.useServer
  ? []
  : MOCK_TRACKS.map((track) => ({ ...track, hasMedia: true }));
const remoteTracks = new Map();
let hydrated = false;
let hydratingPromise = null;
const apiClient = serverApi;

async function ensureHydrated() {
  if (hydrated) return;
  if (!hydratingPromise) {
    hydratingPromise = (async () => {
      const added = await loadJSON(STORAGE_KEYS.library, []);
      if (Array.isArray(added) && added.length) {
        const knownIds = new Set(library.map((t) => t.id));
        library = [...library, ...added.filter((t) => !knownIds.has(t.id))];
      }
      hydrated = true;
    })();
  }
  await hydratingPromise;
}

async function persistAdded() {
  const baseIds = new Set(MOCK_TRACKS.map((t) => t.id));
  const added = library.filter((t) => !baseIds.has(t.id));
  await saveJSON(STORAGE_KEYS.library, added);
}

export const musicService = {
  isServerConfigured: apiClient !== null,

  getStreamSource(track, headers = {}) {
    if (!apiClient) throw new Error("Auric API is not configured");
    if (track?.hasMedia === false) throw new Error("TRACK_HAS_NO_MEDIA");
    const token = authSession.getToken();
    if (!token) throw new Error("AUTHENTICATION_REQUIRED");
    return createTrackStreamSource(apiConfig.baseUrl, track?.id, {
      ...headers,
      Authorization: `Bearer ${token}`,
    });
  },

  async getLibraryPage({ cursor, limit = 50, signal } = {}) {
    if (apiClient) {
      const response = await apiClient.get("/api/v1/tracks", {
        query: { cursor, limit },
        signal,
      });
      const items = response.data.map(mapTrackDto);
      items.forEach((track) => remoteTracks.set(track.id, track));
      return { items, nextCursor: response.meta?.nextCursor ?? null };
    }
    await ensureHydrated();
    const start = cursor ? Number(cursor) : 0;
    const items = library.slice(start, start + limit);
    return {
      items,
      nextCursor:
        start + items.length < library.length
          ? String(start + items.length)
          : null,
    };
  },

  async searchTracks(query, { limit = 20, signal } = {}) {
    if (!apiClient) throw new Error("Auric API is not configured");
    const response = await apiClient.get("/api/v1/search/tracks", {
      query: { q: query, limit },
      signal,
    });
    const items = response.data.map(mapTrackDto);
    items.forEach((track) => remoteTracks.set(track.id, track));
    return items;
  },

  async getAllTracks() {
    if (apiClient) {
      try {
        const items = [];
        let cursor;
        do {
          const page = await this.getLibraryPage({ cursor, limit: 100 });
          items.push(...page.items);
          cursor = page.nextCursor || undefined;
        } while (cursor);
        library = items;
        await saveJSON(STORAGE_KEYS.library, items);
        return items;
      } catch (error) {
        const cached = await loadJSON(STORAGE_KEYS.library, []);
        if (Array.isArray(cached) && cached.length) {
          library = cached;
          return cached;
        }
        throw error;
      }
    }
    await ensureHydrated();
    return library;
  },

  async getTrackById(id) {
    await ensureHydrated();
    const local = library.find((t) => t.id === id) || remoteTracks.get(id);
    if (local || !apiClient) return local || null;
    const response = await apiClient.get(
      `/api/v1/tracks/${encodeURIComponent(id)}`,
    );
    const track = mapTrackDto(response.data);
    remoteTracks.set(track.id, track);
    return track;
  },

  async getTracksByIds(ids) {
    await ensureHydrated();
    const byId = new Map(
      [...library, ...remoteTracks.values()].map((t) => [t.id, t]),
    );
    return ids.map((id) => byId.get(id)).filter(Boolean);
  },

  async getTrackCount() {
    await ensureHydrated();
    return library.length;
  },

  /** Used by Add Music once a mock "download" reaches Ready. */
  async addTrack(input) {
    await ensureHydrated();
    const id = generateId("add");
    const track = {
      id,
      title: input.title,
      artists: input.artists?.length ? input.artists : ["Unknown"],
      version: input.version || null,
      album: input.album || null,
      releaseYear: input.releaseYear || null,
      durationMs: input.durationMs || 210000,
      visualSeed: id,
      aliases: input.searchAliases || [],
      playWeight: 0,
      lastPlayedDaysAgo: null,
      likedSeed: false,
      hasMedia: true,
    };
    library = [track, ...library];
    await persistAdded();
    return track;
  },

  /** Random distinct tracks, used by shuffle/quick-picks fallbacks. */
  async getRandomTracks(count, excludeIds = []) {
    await ensureHydrated();
    const excluded = new Set(excludeIds);
    const pool = library.filter((t) => !excluded.has(t.id));
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  },
};

export default musicService;
