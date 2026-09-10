import { create } from 'zustand';
import { addMusicService, STATUS_STEPS } from '../services/addMusicService';
import { useLibraryStore } from './useLibraryStore';

/** Add Music screen state: the pasted JSON, its parsed preview, validation error, and the
 *  simulated Queued/Downloading/Processing/Ready pipeline. */
export const useAddMusicStore = create((set, get) => ({
  json: '',
  input: null,
  preview: null,
  error: null,
  errorOpen: false,
  status: -1, // -1 = not started, otherwise index into STATUS_STEPS
  copied: false,

  setJson(json) {
    set({ json });
  },

  validate() {
    try {
      const { input, preview } = addMusicService.parseAndValidate(get().json);
      set({ input, preview, error: null, errorOpen: false, status: -1 });
    } catch (e) {
      set({ input: null, preview: null, error: e.message, errorOpen: false });
    }
  },

  toggleErrorDetail() {
    set((s) => ({ errorOpen: !s.errorOpen }));
  },

  markCopied() {
    set({ copied: true });
    setTimeout(() => set({ copied: false }), 1800);
  },

  async addTrack() {
    const { input } = get();
    if (!input) return;
    set({ status: 0 });
    const track = await addMusicService.runAddFlow(input, (step) => set({ status: step }));
    useLibraryStore.setState((s) => ({
      tracks: [track, ...s.tracks],
      tracksById: { ...s.tracksById, [track.id]: track },
    }));
    return track;
  },

  reset() {
    set({ json: '', input: null, preview: null, error: null, errorOpen: false, status: -1, copied: false });
  },
}));

export const ADD_STATUS_STEPS = STATUS_STEPS;
export default useAddMusicStore;
