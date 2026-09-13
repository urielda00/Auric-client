import { create } from 'zustand';
import { musicService } from '../services/musicService';
import { likesService } from '../services/likesService';
import { historyService } from '../services/historyService';

const {
  createLikeMutationCoordinator,
} = require('../services/likeMutation.cjs');

/** Canonical client cache for library Tracks, likes, and product History. */
export const useLibraryStore = create((set, get) => {
  let libraryRequestVersion = 0;
  let likesRequestVersion = 0;
  let historyRequestVersion = 0;

  const cacheActivityTracks = (items) => {
    const tracks = items.map((item) => item.track).filter(Boolean);
    if (!tracks.length) return;
    set((state) => ({
      tracksById: {
        ...state.tracksById,
        ...Object.fromEntries(tracks.map((track) => [track.id, track])),
      },
    }));
  };

  const likeMutations = createLikeMutationCoordinator({
    getLikedIds: () => get().likedIds,
    setLikedIds: (likedIds) => set({ likedIds }),
    mutate: (trackId, liked) => likesService.setLiked(trackId, liked),
    onPending: (trackId, isPending) =>
      set((state) => ({
        likePendingIds: isPending
          ? [...state.likePendingIds, trackId]
          : state.likePendingIds.filter((id) => id !== trackId),
      })),
  });

  return {
    tracks: [],
    tracksById: {},
    likedIds: [],
    likePendingIds: [],
    likesStatus: 'idle',
    likesError: null,
    history: [],
    historyStatus: 'idle',
    historyError: null,
    historyNextCursor: null,
    hydrated: false,
    libraryStatus: 'idle',
    libraryError: null,

    async hydrate() {
      const tracks = await musicService.hydrateLibraryCache();
      set({
        tracks,
        tracksById: Object.fromEntries(tracks.map((track) => [track.id, track])),
        hydrated: true,
      });
    },

    async refreshLibrary() {
      const requestVersion = ++libraryRequestVersion;
      set({ libraryStatus: 'loading', libraryError: null });
      try {
        const result = await musicService.refreshLibrary();
        if (requestVersion !== libraryRequestVersion || !result.applied) return;
        set({
          tracks: result.tracks,
          tracksById: Object.fromEntries(
            result.tracks.map((track) => [track.id, track]),
          ),
          libraryStatus: 'success',
        });
      } catch (error) {
        if (requestVersion === libraryRequestVersion) {
          set({ libraryStatus: 'error', libraryError: error });
        }
      }
    },

    getTrackById(id) {
      return get().tracksById[id] || null;
    },

    cacheTracks(tracks) {
      set((state) => ({
        tracksById: {
          ...state.tracksById,
          ...Object.fromEntries(tracks.map((track) => [track.id, track])),
        },
      }));
    },

    isLiked(id) {
      return get().likedIds.includes(id);
    },

    async refreshLikes() {
      const requestVersion = ++likesRequestVersion;
      set({ likesStatus: 'loading', likesError: null });
      try {
        const items = await likesService.getLikedTracks();
        if (requestVersion !== likesRequestVersion) return;
        cacheActivityTracks(items);
        set({
          likedIds: items.map(({ track }) => track.id),
          likesStatus: 'success',
        });
      } catch (error) {
        if (requestVersion === likesRequestVersion) {
          set({ likesStatus: 'error', likesError: error });
        }
      }
    },

    async toggleLike(id) {
      likesRequestVersion += 1;
      set({ likesError: null, likesStatus: 'success' });
      try {
        await likeMutations.toggle(id);
        return true;
      } catch (error) {
        set({ likesError: error, likesStatus: 'error' });
        return false;
      }
    },

    async refreshHistory() {
      const requestVersion = ++historyRequestVersion;
      set({ historyStatus: 'loading', historyError: null });
      try {
        const page = await historyService.getPage({ limit: 50 });
        if (requestVersion !== historyRequestVersion) return;
        cacheActivityTracks(page.items);
        set({
          history: page.items,
          historyNextCursor: page.nextCursor,
          historyStatus: 'success',
        });
      } catch (error) {
        if (requestVersion === historyRequestVersion) {
          set({ historyStatus: 'error', historyError: error });
        }
      }
    },

    async loadMoreHistory() {
      const { historyNextCursor, historyStatus } = get();
      if (!historyNextCursor || historyStatus === 'loadingMore') return;
      const requestVersion = ++historyRequestVersion;
      set({ historyStatus: 'loadingMore', historyError: null });
      try {
        const page = await historyService.getPage({
          cursor: historyNextCursor,
          limit: 50,
        });
        if (requestVersion !== historyRequestVersion) return;
        cacheActivityTracks(page.items);
        set((state) => ({
          history: [
            ...state.history,
            ...page.items.filter(
              (item) =>
                !state.history.some((current) => current.id === item.id),
            ),
          ],
          historyNextCursor: page.nextCursor,
          historyStatus: 'success',
        }));
      } catch (error) {
        if (requestVersion === historyRequestVersion) {
          set({ historyStatus: 'error', historyError: error });
        }
      }
    },

    /** Mock mode appends locally; server mode derives History from sessions. */
    async recordPlay(trackId) {
      const next = await historyService.recordPlay(trackId);
      if (!historyService.isServerBacked) set({ history: next });
    },

    async clearHistory() {
      const next = await historyService.clear();
      if (!historyService.isServerBacked) set({ history: next });
    },

    async addTrack(input) {
      libraryRequestVersion += 1;
      const track = await musicService.addTrack(input);
      set((state) => ({
        tracks: [track, ...state.tracks],
        tracksById: { ...state.tracksById, [track.id]: track },
      }));
      return track;
    },
  };
});

export default useLibraryStore;
