import { musicService } from './musicService';
import { likesService } from './likesService';
import { historyService } from './historyService';
import { formatHoursMinutes } from '../utils/format';

/**
 * Everything on the Stats screen is derived from mock state rather than hardcoded, so it
 * reacts to what actually happens in the app (playing, liking, rediscovering a track).
 * `LIBRARY_TRACK_COUNT` is the one fixed figure — it describes the real ~1,684-track home
 * server library the design was written for, not the small fixture set used to exercise
 * the UI in this mock phase.
 */
const LIBRARY_TRACK_COUNT = 1684;
const BASELINE_PLAY_MULTIPLIER = 42; // turns a track's mock playWeight into a plausible play count

export const statsService = {
  async getStats() {
    const [tracks, likedIds, historyEntries] = await Promise.all([
      musicService.getAllTracks(),
      likesService.getLikedIds(),
      historyService.getEntries(),
    ]);

    const liveCounts = new Map();
    for (const entry of historyEntries) {
      liveCounts.set(entry.trackId, (liveCounts.get(entry.trackId) || 0) + 1);
    }

    const withPlays = tracks.map((track) => {
      const baseline = Math.round((track.playWeight || 0.05) * BASELINE_PLAY_MULTIPLIER);
      const live = liveCounts.get(track.id) || 0;
      return { track, plays: baseline + live, live };
    });

    const totalMs = withPlays.reduce((sum, x) => sum + x.plays * x.track.durationMs, 0);
    const listeningMinutes = totalMs / 1000 / 60;

    const topTracks = [...withPlays]
      .sort((a, b) => b.plays - a.plays)
      .slice(0, 5);
    const topPlays = topTracks[0]?.plays || 1;

    const differentSongsPlayed = new Set(historyEntries.map((e) => e.trackId)).size;

    const rediscovered = withPlays
      .filter((x) => x.live > 0 && x.track.lastPlayedDaysAgo != null && x.track.lastPlayedDaysAgo >= 60)
      .map((x) => x.track);

    return {
      listeningLabel: formatHoursMinutes(listeningMinutes),
      listeningMinutes,
      tiles: [
        { value: LIBRARY_TRACK_COUNT.toLocaleString('en-US'), label: 'Tracks in library', color: '#EDEDF2' },
        { value: String(likedIds.length), label: 'Liked tracks', color: '#EFA6C6' },
        { value: String(differentSongsPlayed), label: 'Different songs played', color: '#C4B1FF' },
        { value: String(rediscovered.length), label: 'Rediscovered this month', color: '#9FE3EC' },
      ],
      topTracks: topTracks.map((x, i) => ({
        track: x.track,
        rank: i + 1,
        plays: x.plays,
        pct: Math.max(6, Math.round((x.plays / topPlays) * 100)),
      })),
      rediscovered,
    };
  },
};

export default statsService;
