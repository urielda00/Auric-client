import { loadJSON, saveJSON, STORAGE_KEYS } from './storage';
import { MOCK_TRACKS } from '../mocks/tracks';
import { apiConfig } from './apiConfig';
import { serverApi } from './serverApi';
import { musicService } from './musicService';

const { createLikesApi } = require('./activityApi.cjs');

const remoteLikes = serverApi ? createLikesApi(serverApi) : null;

/** Liked ids, newest-liked first. Seeded once from the mock library's `likedSeed` flags. */
export const likesService = {
  isServerBacked: remoteLikes !== null,

  async getLikedTracks(options = {}) {
    if (remoteLikes) return remoteLikes.list(options);
    const ids = await this.getLikedIds();
    const tracks = await musicService.getTracksByIds(ids);
    const tracksById = new Map(tracks.map((track) => [track.id, track]));
    return ids
      .map((id) => tracksById.get(id))
      .filter(Boolean)
      .map((track, index) => ({ track, likedAtMs: ids.length - index }));
  },

  async getLikedIds() {
    if (remoteLikes) {
      return (await remoteLikes.list()).map(({ track }) => track.id);
    }
    const stored = await loadJSON(STORAGE_KEYS.liked, null);
    if (stored) return stored;
    const seeded = MOCK_TRACKS.filter((t) => t.likedSeed).map((t) => t.id);
    await saveJSON(STORAGE_KEYS.liked, seeded);
    return seeded;
  },

  async setLikedIds(ids) {
    if (apiConfig.useServer) return ids;
    await saveJSON(STORAGE_KEYS.liked, ids);
    return ids;
  },

  async like(id) {
    if (remoteLikes) {
      await remoteLikes.like(id);
      return this.getLikedIds();
    }
    const ids = await this.getLikedIds();
    if (ids.includes(id)) return ids;
    const next = [id, ...ids];
    await this.setLikedIds(next);
    return next;
  },

  async unlike(id) {
    if (remoteLikes) {
      await remoteLikes.unlike(id);
      return this.getLikedIds();
    }
    const ids = await this.getLikedIds();
    const next = ids.filter((x) => x !== id);
    await this.setLikedIds(next);
    return next;
  },

  async setLiked(id, liked) {
    if (remoteLikes) {
      return liked ? remoteLikes.like(id) : remoteLikes.unlike(id);
    }
    return liked ? this.like(id) : this.unlike(id);
  },
};

export default likesService;
