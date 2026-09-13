import { musicService } from "./musicService";
import { likesService } from "./likesService";
import { serverApi } from "./serverApi";
import { loadJSON, saveJSON, STORAGE_KEYS } from "./storage";

const { createRecommendationApi } = require("./recommendationApi.cjs");
const { createCachedRemoteLoader } = require("./cachedRemoteLoader.cjs");

const remote = serverApi ? createRecommendationApi(serverApi) : null;
const quickPicksLoader = remote
  ? createCachedRemoteLoader({
      loadRemote: (options) => remote.quickPicks(options),
      loadCache: () => loadJSON(STORAGE_KEYS.quickPicks, null),
      saveCache: (value) => saveJSON(STORAGE_KEYS.quickPicks, value),
    })
  : null;
const REASON_META = {
  on_repeat: { label: "On repeat", color: "#C4B1FF" },
  loved: { label: "You love this", color: "#F5B8D2" },
  rediscovery: { label: "Worth revisiting", color: "#9FE3EC" },
  chosen_by_you: { label: "Chosen by you", color: "#C4B1FF" },
  new_to_you: { label: "New to you", color: "#9FE3EC" },
};

function seededShuffle(list, seed) {
  const items = [...list];
  let state = seed >>> 0;
  const random = () => {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280;
  };
  for (let index = items.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [items[index], items[other]] = [items[other], items[index]];
  }
  return items;
}

function decorate(item) {
  const meta = REASON_META[item.reason] || REASON_META.new_to_you;
  return { ...item, label: item.label || meta.label, color: meta.color };
}

function layout(items) {
  const decorated = items.map(decorate);
  return { cards: decorated.slice(0, 4), rows: decorated.slice(4, 8) };
}

function classify(track, likedIds) {
  if (track.lastPlayedDaysAgo != null && track.lastPlayedDaysAgo >= 90) {
    return "rediscovery";
  }
  return likedIds.includes(track.id) ? "loved" : "on_repeat";
}

async function mockQuickPicks(seed) {
  const [tracks, likedIds] = await Promise.all([
    musicService.getAllTracks(),
    likesService.getLikedIds(),
  ]);
  const candidates = tracks.map((track) => ({
    track,
    reason: classify(track, likedIds),
  }));
  const repeated = seededShuffle(
    candidates.filter((item) => item.reason === "on_repeat"),
    seed + 1,
  );
  const loved = seededShuffle(
    candidates.filter((item) => item.reason === "loved"),
    seed + 2,
  );
  const rediscovery = seededShuffle(
    candidates.filter((item) => item.reason === "rediscovery"),
    seed + 3,
  );
  const featured = seededShuffle(
    [...repeated.slice(0, 2), ...loved.slice(0, 2), ...rediscovery.slice(0, 1)],
    seed + 4,
  ).slice(0, 4);
  const used = new Set(featured.map((item) => item.track.id));
  const rows = seededShuffle(
    candidates.filter((item) => !used.has(item.track.id)),
    seed + 5,
  ).slice(0, 4);
  return layout([...featured, ...rows]);
}

function weightedSample(candidates, count) {
  const pool = [...candidates];
  const result = [];
  while (result.length < count && pool.length > 0) {
    const total = pool.reduce((sum, item) => sum + item.weight, 0);
    let target = Math.random() * total;
    let index = 0;
    while (index < pool.length - 1 && target >= pool[index].weight) {
      target -= pool[index].weight;
      index += 1;
    }
    result.push(pool[index].track);
    pool.splice(index, 1);
  }
  return result;
}

export const recommendationService = {
  isServerBacked: remote !== null,

  async getQuickPicks(seed = 0, { signal } = {}) {
    if (!remote) return mockQuickPicks(seed);
    const result = await quickPicksLoader.load({ seed, signal });
    const picks = Array.isArray(result.value)
      ? layout(result.value)
      : result.value;
    return { ...picks, cached: result.cached };
  },

  async getCachedQuickPicks() {
    if (!remote) return null;
    const result = await quickPicksLoader.loadCached();
    if (!result) return null;
    const picks = Array.isArray(result.value)
      ? layout(result.value)
      : result.value;
    return { ...picks, cached: true };
  },

  async getSmartShuffleQueue(count = 30, options = {}) {
    if (remote)
      return (await remote.smartShuffle({ count, ...options })).tracks;
    const [tracks, likedIds] = await Promise.all([
      musicService.getAllTracks(),
      likesService.getLikedIds(),
    ]);
    const excluded = new Set(options.excludeTrackIds || []);
    const weighted = tracks.filter((track) => !excluded.has(track.id)).map((track) => {
      let weight = (track.playWeight || 0.05) * 3;
      if (likedIds.includes(track.id)) weight *= 2;
      if (track.lastPlayedDaysAgo == null || track.lastPlayedDaysAgo >= 90) {
        weight = Math.max(weight, 1.5);
      }
      return { track, weight: Math.max(0.15, weight) };
    });
    return weightedSample(weighted, Math.min(count, tracks.length));
  },

  async getRandomShuffleQueue(count = 30, options = {}) {
    if (remote) return (await remote.random({ count, ...options })).tracks;
    const excluded = new Set(options.excludeTrackIds || []);
    const tracks = (await musicService.getAllTracks()).filter(
      (track) => !excluded.has(track.id),
    );
    return seededShuffle(tracks, Date.now()).slice(
      0,
      count,
    );
  },
};

export default recommendationService;
