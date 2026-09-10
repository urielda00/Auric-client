import { musicService } from './musicService';
import { likesService } from './likesService';

/**
 * Mock recommendation engine. Every function here is a placeholder for a future
 * server-side implementation — screens only ever see `{ track, reason }` pairs or a plain
 * track list, never the weighting logic, so swapping this for a real API later is a
 * same-shape drop-in.
 */

const REASON_META = {
  onRepeat: { label: 'On repeat', color: '#C4B1FF' },
  loved: { label: 'You love this', color: '#F5B8D2' },
  forgotten: { label: 'Not since May', color: '#9FE3EC' },
};

function classify(track, likedIds) {
  if (track.lastPlayedDaysAgo != null && track.lastPlayedDaysAgo >= 90) return 'forgotten';
  if (likedIds.includes(track.id)) return 'loved';
  return 'onRepeat';
}

/** Deterministic-ish shuffle seeded by a number so pull-to-refresh can reshuffle predictably. */
function seededShuffle(list, seed) {
  const arr = [...list];
  let s = seed || 1;
  const rand = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export const recommendationService = {
  /**
   * Quick Picks: a carousel of 4 "reason" cards + a handful of compact rows below, mixing
   * on-repeat / loved / forgotten roughly 2:2:1 as specified by the design. `seed` lets
   * pull-to-refresh produce a visibly different mix without real usage data changing.
   */
  async getQuickPicks(seed = 0) {
    const [tracks, likedIds] = await Promise.all([musicService.getAllTracks(), likesService.getLikedIds()]);
    const withReason = tracks.map((track) => ({ track, reason: classify(track, likedIds) }));
    const onRepeat = seededShuffle(withReason.filter((x) => x.reason === 'onRepeat'), seed + 1);
    const loved = seededShuffle(withReason.filter((x) => x.reason === 'loved'), seed + 2);
    const forgotten = seededShuffle(withReason.filter((x) => x.reason === 'forgotten'), seed + 3);

    const take = (list, n, offset = 0) => {
      const out = [];
      for (let i = 0; i < n && list.length; i++) out.push(list[(i + offset) % list.length]);
      return out;
    };

    // Roughly 2 on-repeat : 2 loved : 1 forgotten across the featured picks.
    const featured = [
      ...take(onRepeat, 2, seed),
      ...take(loved, 2, seed),
      ...take(forgotten, 1, seed),
    ].filter(Boolean);
    const cards = seededShuffle(featured, seed + 4).slice(0, 4).map((x) => withMeta(x));

    const usedIds = new Set(cards.map((c) => c.track.id));
    const remaining = withReason.filter((x) => !usedIds.has(x.track.id));
    const rows = seededShuffle(remaining, seed + 5)
      .slice(0, 4)
      .map((x) => withMeta(x));

    return { cards, rows };
  },

  /**
   * Weighting mirrors the design brief (recent plays, likes, completion, rediscovery,
   * skip-penalty) using the mock signals carried on each track, with a no-repeat window.
   */
  async getSmartShuffleQueue(count = 20) {
    const [tracks, likedIds] = await Promise.all([musicService.getAllTracks(), likesService.getLikedIds()]);
    const weighted = tracks.map((track) => {
      let weight = (track.playWeight || 0.05) * 3;
      if (likedIds.includes(track.id)) weight *= 2;
      if (track.lastPlayedDaysAgo == null || track.lastPlayedDaysAgo >= 90) weight = Math.max(weight, 1.5);
      return { track, weight: Math.max(0.15, weight) };
    });
    return weightedSample(weighted, Math.min(count, tracks.length));
  },

  /** True random permutation across the whole library, no duplicates. */
  async getRandomShuffleQueue(count = 20) {
    const tracks = await musicService.getAllTracks();
    const shuffled = [...tracks].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(count, tracks.length));
  },
};

function withMeta({ track, reason }) {
  return { track, reason, ...REASON_META[reason] };
}

/** Weighted sampling without replacement. */
function weightedSample(weighted, count) {
  const pool = [...weighted];
  const out = [];
  for (let i = 0; i < count && pool.length; i++) {
    const total = pool.reduce((sum, x) => sum + x.weight, 0);
    let r = Math.random() * total;
    let idx = 0;
    for (; idx < pool.length; idx++) {
      r -= pool[idx].weight;
      if (r <= 0) break;
    }
    idx = Math.min(idx, pool.length - 1);
    out.push(pool[idx].track);
    pool.splice(idx, 1);
  }
  return out;
}

export default recommendationService;
