import { formatHoursMinutes } from "../utils/format";
import { historyService } from "./historyService";
import { likesService } from "./likesService";
import { musicService } from "./musicService";
import { serverApi } from "./serverApi";
import { loadJSON, saveJSON, STORAGE_KEYS } from "./storage";

const { createStatsApi } = require("./statsApi.cjs");
const { createCachedRemoteLoader } = require("./cachedRemoteLoader.cjs");

const remote = serverApi ? createStatsApi(serverApi) : null;
const statsLoader = remote
  ? createCachedRemoteLoader({
      loadRemote: (options) => remote.summary(options),
      loadCache: () => loadJSON(STORAGE_KEYS.statsSummary, null),
      saveCache: (value) => saveJSON(STORAGE_KEYS.statsSummary, value),
    })
  : null;

function present(summary, cached = false) {
  const listeningMinutes = summary.totalListeningMs / 60_000;
  const topCount = summary.topTracks[0]?.meaningfulPlays || 1;
  return {
    ...summary,
    cached,
    listeningLabel: formatHoursMinutes(listeningMinutes),
    listeningMinutes,
    tiles: [
      {
        value: summary.libraryTrackCount.toLocaleString("en-US"),
        label: "Tracks in library",
        color: "#EDEDF2",
      },
      {
        value: String(summary.likedTrackCount),
        label: "Liked tracks",
        color: "#EFA6C6",
      },
      {
        value: String(summary.tracksListenedTo),
        label: "Different songs played",
        color: "#C4B1FF",
      },
      {
        value: String(summary.rediscoveredTracks.length),
        label: "Rediscovered this month",
        color: "#9FE3EC",
      },
    ],
    topTracks: summary.topTracks.map((item, index) => ({
      track: item.track,
      rank: index + 1,
      plays: item.meaningfulPlays,
      pct: Math.max(6, Math.round((item.meaningfulPlays / topCount) * 100)),
    })),
    rediscovered: summary.rediscoveredTracks,
  };
}

async function mockSummary() {
  const [tracks, likedIds, history] = await Promise.all([
    musicService.getAllTracks(),
    likesService.getLikedIds(),
    historyService.getEntries(),
  ]);
  const counts = new Map();
  for (const entry of history)
    counts.set(entry.trackId, (counts.get(entry.trackId) || 0) + 1);
  const withPlays = [...counts.entries()]
    .map(([trackId, meaningfulPlays]) => ({
      track: tracks.find((item) => item.id === trackId),
      meaningfulPlays,
      listenedMs:
        meaningfulPlays *
        (tracks.find((item) => item.id === trackId)?.durationMs || 0),
    }))
    .filter((item) => item.track)
    .sort((left, right) => right.meaningfulPlays - left.meaningfulPlays);
  const topTracks = withPlays.slice(0, 5);
  return {
    generatedAtMs: Date.now(),
    windowStartedAtMs: Date.UTC(new Date().getUTCFullYear(), 0, 1),
    libraryTrackCount: tracks.length,
    playableTrackCount: tracks.filter((track) => track.hasMedia !== false)
      .length,
    likedTrackCount: likedIds.length,
    totalListeningMs: withPlays.reduce((sum, item) => sum + item.listenedMs, 0),
    meaningfulPlays: history.length,
    completedPlays: history.length,
    tracksListenedTo: counts.size,
    topTracks,
    rediscoveredTracks: [],
  };
}

export const statsService = {
  isServerBacked: remote !== null,

  async getStats(options = {}) {
    if (!remote) return present(await mockSummary());
    const result = await statsLoader.load(options);
    return present(result.value, result.cached);
  },
};

export default statsService;
