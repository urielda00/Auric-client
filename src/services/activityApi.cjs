const { mapTrackDto } = require('./trackMapper.cjs');

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`Invalid ${label} response`);
  return value;
}

function mapLikedTrackDto(dto) {
  if (!Number.isSafeInteger(dto?.liked_at_ms) || dto.liked_at_ms < 0) {
    throw new Error('Invalid Like response');
  }
  return { track: mapTrackDto(dto), likedAtMs: dto.liked_at_ms };
}

function mapHistoryEntryDto(dto) {
  if (
    !dto ||
    typeof dto !== 'object' ||
    typeof dto.session_id !== 'string' ||
    !Number.isSafeInteger(dto.played_at_ms) ||
    dto.played_at_ms < 0
  ) {
    throw new Error('Invalid History response');
  }
  return {
    id: dto.session_id,
    trackId: dto.track?.id,
    playedAt: new Date(dto.played_at_ms).toISOString(),
    track: mapTrackDto(dto.track),
  };
}

function createLikesApi(client) {
  return {
    async list(options = {}) {
      const response = await client.get('/api/v1/likes', options);
      return requireArray(response.data, 'Likes').map(mapLikedTrackDto);
    },
    async like(trackId, options = {}) {
      const response = await client.put(
        `/api/v1/tracks/${encodeURIComponent(trackId)}/like`,
        {},
        options,
      );
      return mapLikedTrackDto(response.data);
    },
    async unlike(trackId, options = {}) {
      await client.delete(
        `/api/v1/tracks/${encodeURIComponent(trackId)}/like`,
        options,
      );
    },
  };
}

function createHistoryApi(client) {
  return {
    async page({ cursor, limit = 50, signal } = {}) {
      const response = await client.get('/api/v1/history', {
        query: { cursor, limit },
        signal,
      });
      return {
        items: requireArray(response.data, 'History').map(mapHistoryEntryDto),
        nextCursor: response.meta?.nextCursor ?? null,
      };
    },
  };
}

function createListeningApi(client) {
  return {
    async start(session) {
      return client.post('/api/v1/listening-sessions', {
        id: session.id,
        track_id: session.trackId,
        started_at_ms: session.startedAtMs,
        start_position_ms: session.startPositionMs,
        context: session.context,
      });
    },
    async checkpoint(session) {
      return client.patch(
        `/api/v1/listening-sessions/${encodeURIComponent(session.id)}`,
        {
          listened_ms: session.listenedMs,
          position_ms: session.positionMs,
        },
      );
    },
    async end(session, endedReason) {
      return client.post(
        `/api/v1/listening-sessions/${encodeURIComponent(session.id)}/end`,
        {
          listened_ms: session.listenedMs,
          position_ms: session.positionMs,
          ended_reason: endedReason,
        },
      );
    },
  };
}

module.exports = {
  createHistoryApi,
  createLikesApi,
  createListeningApi,
  mapHistoryEntryDto,
  mapLikedTrackDto,
};
