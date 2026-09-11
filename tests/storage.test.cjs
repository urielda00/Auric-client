const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const test = require("node:test");

const storageSource = readFileSync(
  require.resolve("../src/services/storage.js"),
  "utf8",
);

test("uses a valid dedicated SecureStore key for every auth-token operation", () => {
  const keyMatch = storageSource.match(
    /const SECURE_AUTH_TOKEN_KEY = "([^"]+)";/,
  );

  assert.ok(keyMatch, "expected a dedicated SecureStore auth-token key");
  assert.equal(keyMatch[1], "auric.authToken");
  assert.match(keyMatch[1], /^[A-Za-z0-9._-]+$/);

  for (const operation of ["getItemAsync", "setItemAsync", "deleteItemAsync"]) {
    assert.match(
      storageSource,
      new RegExp(`SecureStore\\.${operation}\\(SECURE_AUTH_TOKEN_KEY`),
    );
  }

  assert.doesNotMatch(storageSource, /SecureStore\.[A-Za-z]+\(key\("authToken"\)/);
});
