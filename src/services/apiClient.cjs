class ApiError extends Error {
  constructor({ code, message, details, requestId, status, retryable = false, cause }) {
    super(message, { cause });
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
    this.requestId = requestId;
    this.status = status;
    this.retryable = retryable;
  }
}

function createApiClient({ baseUrl, timeoutMs = 10000, fetchImpl = globalThis.fetch }) {
  if (!baseUrl) throw new Error('Auric API base URL is not configured');
  if (typeof fetchImpl !== 'function') throw new Error('Fetch is unavailable');

  return {
    async get(path, { query, signal } = {}) {
      const controller = new AbortController();
      const onAbort = () => controller.abort(signal?.reason);
      signal?.addEventListener('abort', onAbort, { once: true });
      const timeout = setTimeout(() => controller.abort(new Error('Request timed out')), timeoutMs);
      const url = new URL(`${baseUrl}${path}`);
      Object.entries(query || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
      });

      try {
        let response;
        try {
          response = await fetchImpl(url.toString(), {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: controller.signal,
          });
        } catch (cause) {
          if (signal?.aborted) throw cause;
          const timedOut = controller.signal.aborted;
          throw new ApiError({
            code: timedOut ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR',
            message: timedOut ? 'The server took too long to respond' : 'Could not reach the Auric server',
            status: 0,
            retryable: true,
            cause,
          });
        }

        let body;
        try {
          body = await response.json();
        } catch (cause) {
          throw new ApiError({
            code: 'INVALID_RESPONSE',
            message: 'The Auric server returned an invalid response',
            status: response.status,
            retryable: response.status >= 500,
            cause,
          });
        }

        if (!response.ok) {
          const error = body?.error;
          throw new ApiError({
            code: error?.code || 'HTTP_ERROR',
            message: error?.message || 'The Auric server rejected the request',
            details: error?.details,
            requestId: error?.requestId,
            status: response.status,
            retryable: response.status >= 500,
          });
        }
        if (!body || !Object.prototype.hasOwnProperty.call(body, 'data')) {
          throw new ApiError({
            code: 'INVALID_RESPONSE',
            message: 'The Auric server response is missing data',
            status: response.status,
          });
        }
        return body;
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', onAbort);
      }
    },
  };
}

module.exports = { ApiError, createApiClient };
