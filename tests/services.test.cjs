const assert = require('node:assert/strict');
const test = require('node:test');

const { ApiError, createApiClient } = require('../src/services/apiClient.cjs');
const { createLatestSearchRunner } = require('../src/services/latestSearch.cjs');
const { isTrackPlayable, mapTrackDto } = require('../src/services/trackMapper.cjs');

const DTO = {
  id: '018f0000-0000-7000-8000-000000000001',
  title: 'Track',
  artists: ['First', 'Second'],
  version: null,
  album: 'Album',
  release_year: 2024,
  genre: 'Pop',
  duration_ms: 123000,
  has_media: false,
};

test('maps the server Track DTO and preserves metadata-only state', () => {
  const track = mapTrackDto(DTO);
  assert.deepEqual(track.artists, ['First', 'Second']);
  assert.equal(track.releaseYear, 2024);
  assert.equal(track.durationMs, 123000);
  assert.equal(track.hasMedia, false);
  assert.equal(isTrackPlayable(track), false);
});

test('API client parses successful envelopes', async () => {
  const client = createApiClient({
    baseUrl: 'http://auric.test',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: DTO, meta: { nextCursor: null } }),
    }),
  });
  const response = await client.get('/api/v1/tracks/example');
  assert.equal(response.data.title, 'Track');
});

test('API client preserves canonical server errors', async () => {
  const client = createApiClient({
    baseUrl: 'http://auric.test',
    fetchImpl: async () => ({
      ok: false,
      status: 422,
      json: async () => ({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Request validation failed',
          requestId: 'request-1',
        },
      }),
    }),
  });
  await assert.rejects(client.get('/api/v1/search/tracks?q=x'), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, 'VALIDATION_FAILED');
    assert.equal(error.requestId, 'request-1');
    return true;
  });
});

test('API client maps network failures to retryable errors', async () => {
  const client = createApiClient({
    baseUrl: 'http://auric.test',
    fetchImpl: async () => {
      throw new Error('offline');
    },
  });
  await assert.rejects(client.get('/api/v1/tracks'), (error) => {
    assert.equal(error.code, 'NETWORK_ERROR');
    assert.equal(error.retryable, true);
    return true;
  });
});

test('latest search runner debounces and ignores stale responses', async () => {
  const pending = new Map();
  const seen = [];
  const runner = createLatestSearchRunner((query) => new Promise((resolve) => pending.set(query, resolve)), 0);
  runner.run('old', { onSuccess: (result) => seen.push(result) });
  await new Promise((resolve) => setTimeout(resolve, 5));
  runner.run('new', { onSuccess: (result) => seen.push(result) });
  await new Promise((resolve) => setTimeout(resolve, 5));
  pending.get('new')(['new result']);
  pending.get('old')(['old result']);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(seen, [['new result']]);
  runner.cancel();
});
