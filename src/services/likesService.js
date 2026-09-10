import { loadJSON, saveJSON, STORAGE_KEYS } from './storage';
import { MOCK_TRACKS } from '../mocks/tracks';

/** Liked ids, newest-liked first. Seeded once from the mock library's `likedSeed` flags. */
export const likesService = {
  async getLikedIds() {
    const stored = await loadJSON(STORAGE_KEYS.liked, null);
    if (stored) return stored;
    const seeded = MOCK_TRACKS.filter((t) => t.likedSeed).map((t) => t.id);
    await saveJSON(STORAGE_KEYS.liked, seeded);
    return seeded;
  },

  async setLikedIds(ids) {
    await saveJSON(STORAGE_KEYS.liked, ids);
    return ids;
  },

  async like(id) {
    const ids = await this.getLikedIds();
    if (ids.includes(id)) return ids;
    const next = [id, ...ids];
    await this.setLikedIds(next);
    return next;
  },

  async unlike(id) {
    const ids = await this.getLikedIds();
    const next = ids.filter((x) => x !== id);
    await this.setLikedIds(next);
    return next;
  },
};

export default likesService;
