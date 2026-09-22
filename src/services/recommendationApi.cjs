const { mapTrackDto } = require("./trackMapper.cjs");

const REASONS = new Set([
  "on_repeat",
  "loved",
  "rediscovery",
  "chosen_by_you",
  "new_to_you",
]);

function mapQuickPick(value) {
  if (
    !value ||
    typeof value !== "object" ||
    !REASONS.has(value.reason) ||
    typeof value.reason_label !== "string"
  ) {
    throw new Error("Invalid Quick Pick response");
  }
  return {
    track: mapTrackDto(value.track),
    reason: value.reason,
    label: value.reason_label,
  };
}

function mapGeneratedQueue(value) {
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.algorithm_version !== "string" ||
    !Number.isSafeInteger(value.generated_at_ms) ||
    !Array.isArray(value.tracks)
  ) {
    throw new Error("Invalid recommendation queue response");
  }
  const tracks = value.tracks
    .map(mapTrackDto)
    .filter(
      (track, index, mapped) =>
        mapped.findIndex((candidate) => candidate.id === track.id) === index,
    );
  return {
    algorithmVersion: value.algorithm_version,
    generatedAtMs: value.generated_at_ms,
    seed: value.seed ?? null,
    tracks,
  };
}

function createRecommendationApi(client) {
  return {
    async quickPicks({ seed, signal, excludeTrackIds = [] } = {}) {
      const path = "/api/v1/recommendations/quick-picks";
      const query = {
        ...(seed === undefined ? {} : { seed }),
        ...(excludeTrackIds.length ? { exclude_track_ids: excludeTrackIds.join(",") } : {}),
      };
      if (typeof __DEV__ !== "undefined" && __DEV__) {
        console.debug("[AuricHome] network GET", { path, query });
      }
      const response = await client.get(path, {
        query,
        signal,
      });
      if (!Array.isArray(response.data))
        throw new Error("Invalid Quick Picks response");
      if (typeof __DEV__ !== "undefined" && __DEV__) {
        console.debug("[AuricHome] network IDs", response.data.map((item) => item.track?.id));
      }
      return response.data.map(mapQuickPick);
    },
    async smartShuffle({ count = 30, excludeTrackIds = [], signal } = {}) {
      const response = await client.post(
        "/api/v1/recommendations/smart-shuffle",
        { count, exclude_track_ids: excludeTrackIds },
        { signal },
      );
      return mapGeneratedQueue(response.data);
    },
    async random({ count = 30, excludeTrackIds = [], signal } = {}) {
      const response = await client.post(
        "/api/v1/recommendations/random",
        { count, exclude_track_ids: excludeTrackIds },
        { signal },
      );
      return mapGeneratedQueue(response.data);
    },
  };
}

function createRecommendationRequestCoordinator() {
  let generation = 0;
  let pendingMode = null;
  return {
    begin(mode) {
      if (pendingMode === mode) return null;
      generation += 1;
      pendingMode = mode;
      return { generation, mode };
    },
    isCurrent(token) {
      return token?.generation === generation && token?.mode === pendingMode;
    },
    finish(token) {
      if (!this.isCurrent(token)) return false;
      pendingMode = null;
      return true;
    },
    invalidate() {
      generation += 1;
      pendingMode = null;
    },
    pendingMode() {
      return pendingMode;
    },
  };
}

function createLatestRequestGate() {
  let generation = 0;
  return {
    begin() {
      generation += 1;
      return generation;
    },
    isCurrent(token) {
      return token === generation;
    },
    invalidate() {
      generation += 1;
    },
  };
}

function freshQuickPicksSeed(previous, random = Math.random) {
  const candidate = Math.floor(random() * 0x1_0000_0000) >>> 0;
  return candidate === previous ? (candidate + 1) >>> 0 : candidate;
}

module.exports = {
  createLatestRequestGate,
  createRecommendationApi,
  createRecommendationRequestCoordinator,
  freshQuickPicksSeed,
  mapGeneratedQueue,
  mapQuickPick,
};
