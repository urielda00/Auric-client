import { create } from 'zustand';
import { addMusicService, STATUS_STEPS } from '../services/addMusicService';
import { useLibraryStore } from './useLibraryStore';

const STATUS_INDEX = {
  queued: 0,
  downloading: 1,
  processing: 2,
  ready: 3,
};

let activeController = null;
let operationId = 0;

function cacheReadyTrack(track) {
  if (!track) return;
  useLibraryStore.setState((state) => ({
    tracks: [track, ...state.tracks.filter((item) => item.id !== track.id)],
    tracksById: { ...state.tracksById, [track.id]: track },
  }));
}

async function runOperation(set, operation) {
  activeController?.abort();
  activeController = new AbortController();
  const currentOperation = ++operationId;
  set({ submitting: true, failure: null });
  const onJob = (job) => {
    if (currentOperation !== operationId) return;
    set({
      job,
      status: job.status === 'failed' ? 2 : (STATUS_INDEX[job.status] ?? 0),
      failure: job.status === 'failed'
        ? (job.failureMessage || 'Auric could not add this track.')
        : null,
    });
  };
  try {
    const result = await operation(onJob, activeController.signal);
    if (currentOperation !== operationId) return null;
    cacheReadyTrack(result.track);
    set({ job: result.job, submitting: false });
    return result.track;
  } catch (error) {
    if (currentOperation !== operationId || activeController.signal.aborted) return null;
    set({
      submitting: false,
      failure: error?.message || 'Auric could not add this track.',
    });
    return null;
  }
}

export const useAddMusicStore = create((set, get) => ({
  json: '',
  input: null,
  preview: null,
  error: null,
  errorOpen: false,
  status: -1,
  job: null,
  submitting: false,
  failure: null,
  copied: false,

  setJson(json) {
    set({ json });
  },

  validate() {
    try {
      const { input, preview } = addMusicService.parseAndValidate(get().json);
      set({ input, preview, error: null, errorOpen: false, status: -1, job: null, failure: null });
    } catch (error) {
      set({ input: null, preview: null, error: error.message, errorOpen: false });
    }
  },

  toggleErrorDetail() {
    set((state) => ({ errorOpen: !state.errorOpen }));
  },

  markCopied() {
    set({ copied: true });
    setTimeout(() => set({ copied: false }), 1800);
  },

  async addTrack() {
    const { input, submitting } = get();
    if (!input || submitting) return null;
    return runOperation(set, (onJob, signal) =>
      addMusicService.runAddFlow(input, onJob, signal));
  },

  async retry() {
    const { job, submitting } = get();
    if (!job?.id || !job.canRetry || submitting) return null;
    return runOperation(set, (onJob, signal) =>
      addMusicService.retry(job.id, onJob, signal));
  },

  cancelPolling() {
    operationId += 1;
    activeController?.abort();
    activeController = null;
    set({ submitting: false });
  },

  reset() {
    get().cancelPolling();
    set({
      json: '', input: null, preview: null, error: null, errorOpen: false,
      status: -1, job: null, submitting: false, failure: null, copied: false,
    });
  },
}));

export const ADD_STATUS_STEPS = STATUS_STEPS;
export default useAddMusicStore;
