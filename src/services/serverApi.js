import { apiConfig } from "./apiConfig";
import { authSession } from "./authSession";

const { createApiClient } = require("./apiClient.cjs");

export const serverApi = apiConfig.useServer
  ? createApiClient({
      baseUrl: apiConfig.baseUrl,
      timeoutMs: apiConfig.timeoutMs,
      getAccessToken: () => authSession.getToken(),
      onAuthenticationFailure: (failedToken) =>
        authSession.clearIfCurrent(failedToken),
    })
  : null;

export default serverApi;
