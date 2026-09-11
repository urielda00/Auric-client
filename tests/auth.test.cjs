const assert = require("node:assert/strict");
const test = require("node:test");

const { createApiClient } = require("../src/services/apiClient.cjs");
const { createAuthSession } = require("../src/services/authSession.cjs");
const { createPairingFlow } = require("../src/services/pairingFlow.cjs");
const {
  createTrackStreamSource,
} = require("../src/services/audio/streamSource.cjs");

const TOKEN = "a".repeat(43);

function fakeSecureStore(initial = null) {
  let value = initial;
  const writes = [];
  return {
    writes,
    get value() {
      return value;
    },
    async getToken() {
      return value;
    },
    async setToken(next) {
      writes.push(next);
      value = next;
    },
  };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

test("no stored token hydrates to pairing state", async () => {
  const session = createAuthSession({ secureStore: fakeSecureStore() });
  assert.equal(session.snapshot().hydrated, false);
  await session.hydrate();
  assert.deepEqual(session.snapshot(), {
    hydrated: true,
    authenticated: false,
    mock: false,
  });
});

test("valid pairing stores the token only through secure storage and hydrates authentication", async () => {
  const storage = fakeSecureStore();
  const session = createAuthSession({ secureStore: storage });
  const pairing = createPairingFlow({
    authSession: session,
    pairRequest: async () => ({ token: TOKEN, device: { id: "device-1" } }),
  });
  const result = await pairing.pair("AURIC-ABCDE-FGHIJ", "Phone");
  assert.equal(result.stale, false);
  assert.equal(storage.value, TOKEN);
  assert.deepEqual(storage.writes, [TOKEN]);
  assert.equal(session.snapshot().authenticated, true);

  const restored = createAuthSession({ secureStore: storage });
  await restored.hydrate();
  assert.equal(restored.getToken(), TOKEN);
  assert.equal(restored.snapshot().authenticated, true);
});

test("API client injects Authorization centrally and excludes it from pairing", async () => {
  const requests = [];
  const client = createApiClient({
    baseUrl: "https://auric.test",
    getAccessToken: () => TOKEN,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return jsonResponse(200, { data: {} });
    },
  });
  await client.get("/api/v1/tracks");
  await client.post("/api/v1/auth/pair", { code: "code" }, { auth: false });
  assert.equal(requests[0].options.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(
    Object.hasOwn(requests[1].options.headers, "Authorization"),
    false,
  );
});

test("authenticated audio source carries a header and never places the token in its URL", () => {
  const source = createTrackStreamSource("https://auric.test", "track/1", {
    Authorization: `Bearer ${TOKEN}`,
  });
  assert.equal(source.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(source.uri.includes(TOKEN), false);
  assert.equal(source.uri, "https://auric.test/api/v1/tracks/track%2F1/stream");
});

test("401 clears only the token that failed and returns to pairing state", async () => {
  const storage = fakeSecureStore(TOKEN);
  const session = createAuthSession({ secureStore: storage });
  await session.hydrate();
  const client = createApiClient({
    baseUrl: "https://auric.test",
    getAccessToken: () => session.getToken(),
    onAuthenticationFailure: (failed) => session.clearIfCurrent(failed),
    fetchImpl: async () =>
      jsonResponse(401, {
        error: {
          code: "AUTHENTICATION_REQUIRED",
          message: "Device authentication is required",
        },
      }),
  });
  await assert.rejects(client.get("/api/v1/tracks"));
  assert.equal(session.getToken(), null);
  assert.equal(session.snapshot().authenticated, false);
  assert.deepEqual(storage.writes, [null]);
});

test("network outages are retryable and do not clear a stored token", async () => {
  const storage = fakeSecureStore(TOKEN);
  const session = createAuthSession({ secureStore: storage });
  await session.hydrate();
  let authFailures = 0;
  const client = createApiClient({
    baseUrl: "https://auric.test",
    getAccessToken: () => session.getToken(),
    onAuthenticationFailure: async () => {
      authFailures += 1;
    },
    fetchImpl: async () => {
      throw new Error("offline");
    },
  });
  await assert.rejects(
    client.get("/api/v1/tracks"),
    (error) => error.retryable === true,
  );
  assert.equal(authFailures, 0);
  assert.equal(session.getToken(), TOKEN);
  assert.deepEqual(storage.writes, []);
});

test("pairing failures do not save a token and stale pairing responses are ignored", async () => {
  const storage = fakeSecureStore();
  const session = createAuthSession({ secureStore: storage });
  const resolvers = [];
  const pairing = createPairingFlow({
    authSession: session,
    pairRequest: () => new Promise((resolve) => resolvers.push(resolve)),
  });
  const first = pairing.pair("first");
  const second = pairing.pair("second");
  resolvers[0]({ token: "b".repeat(43), device: { id: "old" } });
  assert.equal((await first).stale, true);
  assert.deepEqual(storage.writes, []);
  resolvers[1]({ token: TOKEN, device: { id: "new" } });
  assert.equal((await second).device.id, "new");
  assert.deepEqual(storage.writes, [TOKEN]);

  const failing = createPairingFlow({
    authSession: session,
    pairRequest: async () => {
      throw new Error("invalid");
    },
  });
  await assert.rejects(failing.pair("bad"));
  assert.deepEqual(storage.writes, [TOKEN]);
});

test("cancelling during secure persistence cannot leave a stale pairing token", async () => {
  let releaseWrite;
  const writes = [];
  const storage = {
    async getToken() {
      return null;
    },
    async setToken(value) {
      writes.push(value);
      if (value !== null) {
        await new Promise((resolve) => {
          releaseWrite = resolve;
        });
      }
    },
  };
  const session = createAuthSession({ secureStore: storage });
  const pairing = createPairingFlow({
    authSession: session,
    pairRequest: async () => ({ token: TOKEN, device: { id: "stale" } }),
  });
  const pending = pairing.pair("code");
  await new Promise((resolve) => setImmediate(resolve));
  pairing.cancel();
  releaseWrite();
  assert.equal((await pending).stale, true);
  assert.equal(session.getToken(), null);
  assert.deepEqual(writes, [TOKEN, null]);
});

test("mock mode is authenticated without reading or writing secure storage", async () => {
  const storage = fakeSecureStore();
  const session = createAuthSession({ secureStore: storage, useMocks: true });
  await session.hydrate();
  assert.deepEqual(session.snapshot(), {
    hydrated: true,
    authenticated: true,
    mock: true,
  });
  assert.equal(session.getToken(), null);
  assert.deepEqual(storage.writes, []);
});
