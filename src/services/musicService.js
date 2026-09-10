import { MOCK_TRACKS } from '../mocks/tracks';
import { loadJSON, saveJSON, STORAGE_KEYS } from './storage';
import { generateId } from '../utils/id';

/**
 * The library data source. Every other service reads tracks through here.
 * Backed by mock data + whatever "Add Music" has appended, persisted locally so added
 * tracks survive a reload. Swapping this for a real HTTP client later only touches this
 * file — screens and other services never import mocks/tracks.js directly.
 */

let library = [...MOCK_TRACKS];
let hydrated = false;
let hydratingPromise = null;

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
  async getAllTracks() {
    await ensureHydrated();
    return library;
  },

  async getTrackById(id) {
    await ensureHydrated();
    return library.find((t) => t.id === id) || null;
  },

  async getTracksByIds(ids) {
    await ensureHydrated();
    const byId = new Map(library.map((t) => [t.id, t]));
    return ids.map((id) => byId.get(id)).filter(Boolean);
  },

  async getTrackCount() {
    await ensureHydrated();
    return library.length;
  },

  /** Used by Add Music once a mock "download" reaches Ready. */
  async addTrack(input) {
    await ensureHydrated();
    const id = generateId('add');
    const track = {
      id,
      title: input.title,
      artists: input.artists?.length ? input.artists : ['Unknown'],
      version: input.version || null,
      album: input.album || null,
      releaseYear: input.releaseYear || null,
      durationMs: input.durationMs || 210000,
      visualSeed: id,
      aliases: input.searchAliases || [],
      playWeight: 0,
      lastPlayedDaysAgo: null,
      likedSeed: false,
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
