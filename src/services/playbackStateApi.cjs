const { mapTrackDto } = require("./trackMapper.cjs");

function requireContext(value) {
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.type !== "string" ||
    typeof value.label !== "string"
  ) {
    throw new Error("Invalid playback context response");
  }
  return { type: value.type, label: value.label };
}

function mapItem(value) {
  if (!value || typeof value.id !== "string") {
    throw new Error("Invalid playback queue item response");
  }
  const track = mapTrackDto(value.track);
  return {
    id: value.id,
    trackId: track.id,
    track,
    context: requireContext(value.context),
  };
}

function mapPlaybackSnapshot(dto) {
  if (
    !dto ||
    !Number.isSafeInteger(dto.revision) ||
    dto.revision < 0 ||
    !Number.isSafeInteger(dto.position_ms) ||
    dto.position_ms < 0 ||
    !Array.isArray(dto.upcoming) ||
    !Array.isArray(dto.played)
  ) {
    throw new Error("Invalid playback state response");
  }
  let current = null;
  if (dto.current !== null) {
    if (typeof dto.current?.id !== "string") {
      throw new Error("Invalid current queue item response");
    }
    const track = mapTrackDto(dto.current?.track);
    current = {
      id: dto.current.id,
      trackId: track.id,
      track,
      context: requireContext(dto.current.context),
    };
  }
  return {
    revision: dto.revision,
    current,
    positionMs: dto.position_ms,
    shuffleMode: dto.shuffle_mode ?? null,
    upcoming: dto.upcoming.map(mapItem),
    played: dto.played.map(mapItem),
    updatedAtMs: dto.updated_at_ms ?? 0,
  };
}

function snapshotBody(snapshot, expectedRevision) {
  const context = (value) => value?.type === "recommendation"
    ? { ...value, type: "smart_shuffle" }
    : value;
  const item = (entry) => ({
    id: entry.id,
    track_id: entry.trackId,
    context: context(entry.context),
  });
  return {
    expected_revision: expectedRevision,
    current: snapshot.current
      ? {
          id: snapshot.current.id,
          track_id: snapshot.current.trackId,
          context: context(snapshot.current.context),
        }
      : null,
    position_ms: snapshot.current ? snapshot.positionMs : 0,
    shuffle_mode: snapshot.shuffleMode ?? null,
    upcoming: snapshot.upcoming.map(item),
    played: snapshot.played.map(item),
  };
}

function createPlaybackStateApi(client) {
  return {
    async get(options = {}) {
      const response = await client.get("/api/v1/playback-state", options);
      return mapPlaybackSnapshot(response.data);
    },
    async replace(snapshot, expectedRevision, options = {}) {
      const response = await client.put(
        "/api/v1/playback-state",
        snapshotBody(snapshot, expectedRevision),
        options,
      );
      return mapPlaybackSnapshot(response.data);
    },
    async checkpoint(
      { currentTrackId, positionMs },
      expectedRevision,
      options = {},
    ) {
      const response = await client.patch(
        "/api/v1/playback-state/checkpoint",
        {
          expected_revision: expectedRevision,
          current_track_id: currentTrackId,
          position_ms: positionMs,
        },
        options,
      );
      return mapPlaybackSnapshot(response.data);
    },
  };
}

module.exports = {
  createPlaybackStateApi,
  mapPlaybackSnapshot,
  snapshotBody,
};
