const { mapTrackDto } = require("./trackMapper.cjs");

function naturalNumber(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function mapStatsSummary(value) {
  const fields = [
    "generated_at_ms",
    "window_started_at_ms",
    "library_track_count",
    "playable_track_count",
    "liked_track_count",
    "total_listening_ms",
    "meaningful_plays",
    "completed_plays",
    "tracks_listened_to",
  ];
  if (
    !value ||
    typeof value !== "object" ||
    fields.some((field) => !naturalNumber(value[field])) ||
    !Array.isArray(value.top_tracks) ||
    !Array.isArray(value.rediscovered_tracks)
  ) {
    throw new Error("Invalid Stats response");
  }
  return {
    generatedAtMs: value.generated_at_ms,
    windowStartedAtMs: value.window_started_at_ms,
    libraryTrackCount: value.library_track_count,
    playableTrackCount: value.playable_track_count,
    likedTrackCount: value.liked_track_count,
    totalListeningMs: value.total_listening_ms,
    meaningfulPlays: value.meaningful_plays,
    completedPlays: value.completed_plays,
    tracksListenedTo: value.tracks_listened_to,
    topTracks: value.top_tracks.map((item) => {
      if (
        !item ||
        !naturalNumber(item.meaningful_plays) ||
        !naturalNumber(item.listened_ms)
      )
        throw new Error("Invalid top Track Stats response");
      return {
        track: mapTrackDto(item.track),
        meaningfulPlays: item.meaningful_plays,
        listenedMs: item.listened_ms,
      };
    }),
    rediscoveredTracks: value.rediscovered_tracks.map(mapTrackDto),
  };
}

function createStatsApi(client) {
  return {
    async summary(options = {}) {
      return mapStatsSummary(
        (await client.get("/api/v1/stats/summary", options)).data,
      );
    },
  };
}

module.exports = { createStatsApi, mapStatsSummary };
