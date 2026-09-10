const configuredBaseUrl = process.env.EXPO_PUBLIC_AURIC_API_URL?.trim() || '';

export const apiConfig = Object.freeze({
  baseUrl: configuredBaseUrl.replace(/\/+$/, ''),
  useServer: configuredBaseUrl.length > 0 && process.env.EXPO_PUBLIC_AURIC_USE_MOCKS !== 'true',
  timeoutMs: 10000,
});

export default apiConfig;
