import { apiConfig } from './apiConfig';

const { createApiClient } = require('./apiClient.cjs');

export const serverApi = apiConfig.useServer
  ? createApiClient({
      baseUrl: apiConfig.baseUrl,
      timeoutMs: apiConfig.timeoutMs,
    })
  : null;

export default serverApi;
