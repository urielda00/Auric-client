const assert = require('node:assert/strict');
const test = require('node:test');

const { createApiClient } = require('../src/services/apiClient.cjs');
const {
  createHistoryApi,
  createLikesApi,
  createListeningApi,
} = require('../src/services/activityApi.cjs');
const {
  createLikeMutationCoordinator,
} = require('../src/services/likeMutation.cjs');
const {
  createListeningSessionTracker,
  normalizeListeningContext,
} = require('../src/services/listeningSessionTracker.cjs');

const TRACK_DTO = {
  id: '018f0000-0000-7000-8000-000000000001',
  title: 'Track',
  artists: ['Artist'],
  version: null,
  album: null,
  release_year: 2024,
  genre: 'Pop',
  duration_ms: 120000,
  has_media: true,
};

function memoryStorage(initial = []) {
  return {
    value: initial,
    async load() {
      return this.value;
    },
    async save(value) {
      this.value = JSON.parse(JSON.stringify(value));
    },
  };
}

function fakeListeningApi(overrides = {}) {
  const calls = [];
  return {
    calls,
    async start(session) {
      calls.push(['start', { ...session }]);
      return overrides.start?.(session);
    },
    async checkpoint(session) {
      calls.push(['checkpoint', { ...session }]);
      return overrides.checkpoint?.(session);
    },
    async end(session, reason) {
      calls.push(['end', { ...session }, reason]);
      return overrides.end?.(session, reason);
    },
  };
}

function trackerFixture(options = {}) {
  let now = options.initialNow ?? 1_700_000_000_000;
  let id = 0;
  const api = options.api || fakeListeningApi();
  const storage = options.storage || memoryStorage();
  const starts = [];
  const tracker = createListeningSessionTracker({
    api,
    storage,
    enabled: options.enabled ?? true,
    now: () => now,
    createId: () => `session-${++id}`,
    onStarted: (trackId) => starts.push(trackId),
    checkpointIntervalMs: options.checkpointIntervalMs ?? 30000,
    pauseCheckpointMinimumMs: options.pauseCheckpointMinimumMs ?? 5000,
    persistIntervalMs: 5000,
    maxStatusSampleGapMs: options.maxStatusSampleGapMs ?? 60000,
  });
  return {
    api,
    storage,
    starts,
    tracker,
    advance(ms) {
      now += ms;
    },
  };
}

function status(overrides = {}) {
  return {
    trackId: TRACK_DTO.id,
    itemId: 'item-1',
    positionMs: 0,
    durationMs: 120000,
    isPlaying: false,
    error: null,
    ...overrides,
  };
}

test('API client supports activity verbs and empty 204 responses', async () => {
  const seen = [];
  const client = createApiClient({
    baseUrl: 'https://auric.test',
    fetchImpl: async (_url, options) => {
      seen.push(options.method);
      if (options.method === 'DELETE') {
        return { ok: true, status: 204, json: async () => assert.fail() };
      }
      return { ok: true, status: 200, json: async () => ({ data: {} }) };
    },
  });
  await client.put('/like', {});
  await client.patch('/session', {});
  assert.deepEqual(await client.delete('/like'), { data: null });
  assert.deepEqual(seen, ['PUT', 'PATCH', 'DELETE']);
});

test('likes and History APIs map server Tracks and pagination', async () => {
  const client = {
    async get(path) {
      if (path.endsWith('likes')) {
        return { data: [{ ...TRACK_DTO, liked_at_ms: 123 }] };
      }
      return {
        data: [
          {
            session_id: 'session-1',
            played_at_ms: 1700000000000,
            track: TRACK_DTO,
          },
        ],
        meta: { nextCursor: 'next' },
      };
    },
    async put() {
      return { data: { ...TRACK_DTO, liked_at_ms: 124 } };
    },
    async delete() {},
  };
  const likes = createLikesApi(client);
  const history = createHistoryApi(client);
  assert.equal((await likes.list())[0].track.id, TRACK_DTO.id);
  assert.equal((await likes.like(TRACK_DTO.id)).likedAtMs, 124);
  await likes.unlike(TRACK_DTO.id);
  const page = await history.page({ cursor: 'cursor', limit: 1 });
  assert.equal(page.items[0].trackId, TRACK_DTO.id);
  assert.equal(page.nextCursor, 'next');
});

test('optimistic likes share state, suppress duplicates, and roll back failures', async () => {
  let ids = [];
  let resolveMutation;
  let calls = 0;
  const coordinator = createLikeMutationCoordinator({
    getLikedIds: () => ids,
    setLikedIds: (next) => {
      ids = next;
    },
    mutate: () => {
      calls += 1;
      return new Promise((resolve) => {
        resolveMutation = resolve;
      });
    },
  });
  const first = coordinator.toggle('track-1');
  const duplicate = coordinator.toggle('track-1');
  assert.deepEqual(ids, ['track-1']);
  assert.equal(first, duplicate);
  await Promise.resolve();
  resolveMutation();
  await first;
  assert.equal(calls, 1);

  const failing = createLikeMutationCoordinator({
    getLikedIds: () => ids,
    setLikedIds: (next) => {
      ids = next;
    },
    mutate: async () => {
      throw new Error('offline');
    },
  });
  await assert.rejects(failing.toggle('track-1'), /offline/);
  assert.deepEqual(ids, ['track-1']);
});

test('a failed like rollback preserves another Track mutation', async () => {
  let ids = [];
  const coordinator = createLikeMutationCoordinator({
    getLikedIds: () => ids,
    setLikedIds: (next) => {
      ids = next;
    },
    mutate: async (trackId) => {
      if (trackId === 'first') throw new Error('failed');
    },
  });
  const first = coordinator.toggle('first');
  const firstOutcome = assert.rejects(first, /failed/);
  const second = coordinator.toggle('second');
  await second;
  await firstOutcome;
  assert.deepEqual(ids, ['second']);
});

test('listening starts only on actual play and pause/resume keeps one session', async () => {
  const fixture = trackerFixture();
  fixture.tracker.handleStatus(status(), { type: 'search' });
  assert.equal(fixture.tracker.getSnapshot(), null);
  fixture.tracker.handleStatus(status({ isPlaying: true }), { type: 'search' });
  fixture.advance(7000);
  fixture.tracker.handleStatus(
    status({ isPlaying: false, positionMs: 7000 }),
    { type: 'search' },
  );
  fixture.advance(60000);
  fixture.tracker.handleStatus(
    status({ isPlaying: true, positionMs: 7000 }),
    { type: 'search' },
  );
  fixture.advance(3000);
  fixture.tracker.handleStatus(
    status({ isPlaying: true, positionMs: 10000 }),
    { type: 'search' },
  );
  await fixture.tracker.flush();
  assert.deepEqual(fixture.starts, [TRACK_DTO.id]);
  assert.equal(fixture.tracker.getSnapshot().id, 'session-1');
  assert.equal(fixture.tracker.getSnapshot().listenedMs, 10000);
  assert.equal(
    fixture.api.calls.filter(([name]) => name === 'start').length >= 1,
    true,
  );
});

test('normal session start, checkpoint, and end use one owned session', async () => {
  const fixture = trackerFixture({ checkpointIntervalMs: 5000 });
  fixture.tracker.handleStatus(status({ isPlaying: true }), { type: 'search' });
  fixture.advance(5000);
  fixture.tracker.handleStatus(
    status({ isPlaying: true, positionMs: 5000 }),
    { type: 'search' },
  );
  fixture.advance(1000);
  assert.equal(
    await fixture.tracker.end('skipped_next', 6000, {
      trackId: TRACK_DTO.id,
      playbackItemId: 'item-1',
    }),
    true,
  );
  await fixture.tracker.flush();
  assert.deepEqual(
    fixture.api.calls.map(([operation]) => operation),
    ['start', 'checkpoint', 'end'],
  );
  assert.equal(fixture.api.calls[2][1].id, 'session-1');
  assert.equal(fixture.api.calls[2][1].listenedMs, 6000);
  assert.equal(fixture.api.calls[2][1].positionMs, 6000);
});

test('short playback ends with finite integer millisecond values', async () => {
  const fixture = trackerFixture();
  fixture.tracker.handleStatus(status({ isPlaying: true }), { type: 'direct' });
  fixture.advance(125);
  await fixture.tracker.end('stopped', 125.4, {
    trackId: TRACK_DTO.id,
    playbackItemId: 'item-1',
  });
  const ended = fixture.api.calls.find(([operation]) => operation === 'end');
  assert.equal(ended[1].listenedMs, 125);
  assert.equal(ended[1].positionMs, 125);
});

test('track switch ends A once and starts B as a distinct playback owner', async () => {
  const fixture = trackerFixture();
  fixture.tracker.handleStatus(status({ isPlaying: true }), { type: 'search' });
  fixture.advance(1000);
  fixture.tracker.handleStatus(
    status({
      trackId: '018f0000-0000-7000-8000-000000000002',
      itemId: 'item-2',
      isPlaying: true,
      positionMs: 0,
    }),
    { type: 'manual_queue' },
  );
  await fixture.tracker.flush();
  assert.deepEqual(
    fixture.api.calls.map(([operation, session]) => [operation, session.id]),
    [
      ['start', 'session-1'],
      ['start', 'session-2'],
      ['end', 'session-1'],
    ],
  );
  assert.equal(fixture.tracker.getSnapshot().id, 'session-2');
});

test('stale and duplicate end for A cannot end a newer B session', async () => {
  const fixture = trackerFixture();
  fixture.tracker.handleStatus(status({ isPlaying: true }), { type: 'search' });
  const ownerA = { trackId: TRACK_DTO.id, playbackItemId: 'item-1' };
  fixture.advance(1000);
  await fixture.tracker.end('replaced', 1000, ownerA);
  fixture.tracker.handleStatus(
    status({
      trackId: '018f0000-0000-7000-8000-000000000002',
      itemId: 'item-2',
      isPlaying: true,
      positionMs: 0,
    }),
    { type: 'manual_queue' },
  );
  assert.equal(await fixture.tracker.end('completed', 90_000, ownerA), false);
  assert.equal(fixture.tracker.getSnapshot().id, 'session-2');
  assert.equal(
    fixture.api.calls.filter(([operation]) => operation === 'end').length,
    1,
  );
});

test('seeks do not add time and checkpoints are cumulative and bounded', async () => {
  const fixture = trackerFixture({ checkpointIntervalMs: 30000 });
  fixture.tracker.handleStatus(status({ isPlaying: true }), { type: 'direct' });
  fixture.advance(10000);
  fixture.tracker.handleStatus(
    status({ isPlaying: true, positionMs: 90000 }),
    { type: 'direct' },
  );
  fixture.advance(20000);
  fixture.tracker.handleStatus(
    status({ isPlaying: true, positionMs: 110000 }),
    { type: 'direct' },
  );
  await fixture.tracker.flush();
  const checkpoints = fixture.api.calls.filter(
    ([name]) => name === 'checkpoint',
  );
  assert.equal(checkpoints.length, 1);
  assert.equal(checkpoints[0][1].listenedMs, 30000);
  assert.equal(checkpoints[0][1].positionMs, 110000);
});

test('terminal reasons and all required contexts are preserved', async () => {
  const contexts = {
    search: 'search',
    liked_songs: 'liked_songs',
    history: 'history',
    play_next: 'play_next',
    manual_queue: 'manual_queue',
    resume: 'resume',
    home: 'direct',
  };
  for (const [input, expected] of Object.entries(contexts)) {
    assert.equal(normalizeListeningContext({ type: input }), expected);
  }

  for (const reason of [
    'completed',
    'skipped_next',
    'skipped_previous',
    'replaced',
    'error',
  ]) {
    const fixture = trackerFixture();
    fixture.tracker.handleStatus(status({ isPlaying: true }), {
      type: 'history',
    });
    fixture.advance(1000);
    await fixture.tracker.end(reason, 1000);
    const ended = fixture.api.calls.find(([name]) => name === 'end');
    assert.equal(ended[2], reason);
    assert.equal(ended[1].context, 'history');
  }
});

test('background checkpoint and pending recovery never count closed time', async () => {
  const fixture = trackerFixture();
  fixture.tracker.handleStatus(status({ isPlaying: true }), { type: 'resume' });
  fixture.advance(4000);
  await fixture.tracker.checkpointNow(true);
  assert.equal(
    fixture.api.calls.find(([name]) => name === 'checkpoint')[1].listenedMs,
    4000,
  );

  const pending = [
    {
      id: 'recovered-session',
      trackId: TRACK_DTO.id,
      context: 'search',
      startPositionMs: 100,
      positionMs: 5100,
      durationMs: 120000,
      listenedMs: 5000,
      endedReason: null,
    },
  ];
  const recovery = trackerFixture({ storage: memoryStorage(pending) });
  recovery.advance(999999);
  await recovery.tracker.recoverPending();
  const ended = recovery.api.calls.find(([name]) => name === 'end');
  assert.equal(ended[1].listenedMs, 5000);
  assert.equal(ended[2], 'app_closed');
  assert.deepEqual(recovery.storage.value, []);
});

test('Recents-stop recovery preserves the original elapsed bound', async () => {
  const recoveredAtMs = 1_700_000_100_000;
  const storage = memoryStorage([
    {
      id: 'recovered-session',
      trackId: TRACK_DTO.id,
      context: 'resume',
      startPositionMs: 0,
      positionMs: 45_000,
      durationMs: 120_000,
      listenedMs: 45_000,
      endedReason: null,
    },
  ]);
  const fixture = trackerFixture({ storage, initialNow: recoveredAtMs });
  await fixture.tracker.recoverPending();
  const started = fixture.api.calls.find(([operation]) => operation === 'start');
  const ended = fixture.api.calls.find(([operation]) => operation === 'end');
  assert.equal(started[1].startedAtMs, recoveredAtMs - 45_000);
  assert.equal(ended[1].listenedMs, 45_000);
  assert.equal(ended[2], 'app_closed');
  assert.deepEqual(storage.value, []);
});

test('playback errors end the active session and stale completion cannot clear a new one', async () => {
  let resolveFirstEnd;
  let endCount = 0;
  const api = fakeListeningApi({
    end: () => {
      endCount += 1;
      if (endCount > 1) return Promise.resolve();
      return new Promise((resolve) => {
        resolveFirstEnd = resolve;
      });
    },
  });
  const fixture = trackerFixture({ api });
  fixture.tracker.handleStatus(status({ isPlaying: true }), { type: 'search' });
  fixture.advance(1000);
  const firstEnd = fixture.tracker.end('completed', 1000);
  fixture.tracker.handleStatus(
    status({ isPlaying: true, positionMs: 0 }),
    { type: 'history' },
  );
  await new Promise((resolve) => setImmediate(resolve));
  resolveFirstEnd();
  await firstEnd;
  assert.deepEqual(
    fixture.storage.value.map(({ id }) => id),
    ['session-2'],
  );

  fixture.tracker.handleStatus(
    status({ error: 'decoder', isPlaying: false }),
    { type: 'history' },
  );
  await fixture.tracker.flush();
  assert.equal(
    api.calls.some(
      ([name, , reason]) => name === 'end' && reason === 'error',
    ),
    true,
  );
});

test('mock tracking records actual starts without network or pending state', async () => {
  const fixture = trackerFixture({ enabled: false });
  fixture.tracker.handleStatus(status(), { type: 'direct' });
  fixture.tracker.handleStatus(status({ isPlaying: true }), { type: 'direct' });
  await fixture.tracker.end('completed', 120000);
  assert.deepEqual(fixture.starts, [TRACK_DTO.id]);
  assert.deepEqual(fixture.api.calls, []);
  assert.deepEqual(fixture.storage.value, []);
});

test('listening API sends the authoritative cumulative server contract', async () => {
  const calls = [];
  const api = createListeningApi({
    async post(path, body) {
      calls.push(['POST', path, body]);
      return { data: {} };
    },
    async patch(path, body) {
      calls.push(['PATCH', path, body]);
      return { data: {} };
    },
  });
  const session = {
    id: 'session',
    trackId: TRACK_DTO.id,
    startedAtMs: 1_700_000_000_000,
    startPositionMs: 100,
    positionMs: 5100,
    listenedMs: 5000,
    context: 'search',
  };
  await api.start(session);
  await api.checkpoint(session);
  await api.end(session, 'completed');
  assert.equal(calls[0][2].started_at_ms, 1_700_000_000_000);
  assert.deepEqual(calls[1][2], { listened_ms: 5000, position_ms: 5100 });
  assert.equal(calls[2][2].ended_reason, 'completed');
});
