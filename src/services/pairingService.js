import { authSession } from "./authSession";
import { serverApi } from "./serverApi";

const { createPairingFlow } = require("./pairingFlow.cjs");

const flow = createPairingFlow({
  authSession,
  pairRequest: async (code, displayLabel) => {
    if (!serverApi) throw new Error("Auric API is not configured");
    const response = await serverApi.post(
      "/api/v1/auth/pair",
      {
        code,
        display_label: displayLabel,
      },
      { auth: false },
    );
    return response.data;
  },
});

export const pairingService = flow;
export default pairingService;
