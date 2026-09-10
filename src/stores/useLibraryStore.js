import { create } from 'zustand';
import { musicService } from '../services/musicService';
import { likesService } from '../services/likesService';
import { historyService } from '../services/historyService';

/**
 * Library slice: the track catalogue, likes, and listening history. Screens read tracks
 * and liked/history state from here rather than importing services or mocks directly.
 */
export const useLibraryStore = create((set, get) => ({
  tracks: [],
  tracksById: {},
  likedIds: [],
  history: [],
  hydrated: false,

  async hydrate() {
    const [tracks, likedIds, history] = await Promise.all([
      musicService.getAllTracks(),
      likesService.getLikedIds(),
      historyService.getEntries(),
    ]);
    const tracksById = Object.fromEntries(tracks.map((t) => [t.id, t]));
    set({ tracks, tracksById, likedIds, history, hydrated: true });
  },

  getTrackById(id) {
    return get().tracksById[id] || null;
  },

  isLiked(id) {
    return get().likedIds.includes(id);
  },

  async toggleLike(id) {
    const { likedIds } = get();
    const liked = likedIds.includes(id);
    const next = liked ? await likesService.unlike(id) : await likesService.like(id);
    set({ likedIds: next });
  },

  /** Appends a play event to history — called by the player whenever a track starts. */
  async recordPlay(trackId) {
    const next = await historyService.recordPlay(trackId);
    set({ history: next });
  },

  async clearHistory() {
    const next = await historyService.clear();
    set({ history: next });
  },

  /** Used by Add Music once the mock pipeline reaches "Ready". */
  async addTrack(input) {
    const track = await musicService.addTrack(input);
    set((state) => ({
      tracks: [track, ...state.tracks],
      tracksById: { ...state.tracksById, [track.id]: track },
    }));
    return track;
  },
}));

export default useLibraryStore;
