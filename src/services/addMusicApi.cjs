const IMPORT_STATUSES = new Set(['queued', 'downloading', 'processing', 'ready', 'failed']);

function mapImportJob(dto) {
  if (!dto || typeof dto !== 'object' || typeof dto.id !== 'string' ||
      !IMPORT_STATUSES.has(dto.status) || typeof dto.created_at !== 'string' ||
      typeof dto.updated_at !== 'string' ||
      (dto.track_id !== null && typeof dto.track_id !== 'string') ||
      (dto.failure_code !== null && typeof dto.failure_code !== 'string') ||
      (dto.failure_message !== null && typeof dto.failure_message !== 'string') ||
      typeof dto.can_retry !== 'boolean') {
    throw new Error('Invalid import job response');
  }
  return {
    id: dto.id,
    status: dto.status,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
    trackId: dto.track_id,
    failureCode: dto.failure_code,
    failureMessage: dto.failure_message,
    canRetry: dto.can_retry,
  };
}

function wait(delayMs, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new Error('Polling cancelled'));
      return;
    }
    const abort = () => {
      clearTimeout(timeout);
      reject(signal.reason || new Error('Polling cancelled'));
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, delayMs);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function createAddMusicApi(apiClient, { pollIntervalMs = 1200 } = {}) {
  async function getJob(id, signal) {
    const response = await apiClient.get(`/api/v1/imports/${encodeURIComponent(id)}`, { signal });
    return mapImportJob(response.data);
  }

  async function waitForTerminal(initialJob, onJob, signal) {
    let job = initialJob;
    onJob?.(job);
    while (job.status !== 'ready' && job.status !== 'failed') {
      await wait(pollIntervalMs, signal);
      job = await getJob(job.id, signal);
      onJob?.(job);
    }
    return job;
  }

  return {
    async submit(payload, onJob, signal) {
      const response = await apiClient.post('/api/v1/imports', payload, { signal });
      return waitForTerminal(mapImportJob(response.data), onJob, signal);
    },
    async retry(id, onJob, signal) {
      const response = await apiClient.post(`/api/v1/imports/${encodeURIComponent(id)}/retry`, {}, { signal });
      return waitForTerminal(mapImportJob(response.data), onJob, signal);
    },
    getJob,
  };
}

module.exports = { createAddMusicApi, mapImportJob };
