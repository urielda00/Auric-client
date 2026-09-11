import { apiConfig } from "./apiConfig";
import { secureAuth } from "./storage";

const { createAuthSession } = require("./authSession.cjs");

export const authSession = createAuthSession({
  secureStore: secureAuth,
  useMocks: !apiConfig.useServer,
});

export default authSession;
