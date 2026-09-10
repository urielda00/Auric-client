import { musicService } from './musicService';
import { normalizeSearch } from '../utils/format';
import { loadJSON, saveJSON, STORAGE_KEYS } from './storage';

/** Alternate-spelling map so a search for "harbor" still finds "Harbour". Server-extendable. */
const ALIAS_MAP = {
  harbor: 'harbour',
  emile: 'émile',
  nite: 'night',
  anais: 'anaïs',
  joao: 'joão',
  sigrun: 'sigrún',
  irem: 'i̇rem',
  gorunmez: 'görünmez',
  ikinci: 'i̇kinci',
};

const MAX_RECENTS = 8;

function scoreTrack(track, terms) {
  const hay = normalizeSearch(`${track.title} ${track.version || ''} ${track.artists.join(' ')} ${(track.aliases || []).join(' ')}`);
  const words = hay.split(' ');
  let score = 0;
  for (const term of terms) {
    if (!term) continue;
    if (hay.includes(term)) {
      score += 10;
      continue;
    }
    const prefix = term.length > 2 ? term.slice(0, term.length - 1) : term;
    if (words.some((w) => w.startsWith(prefix))) {
      score += 4;
    }
  }
  return score;
}

export const searchService = {
  /** Local, deterministic, case/diacritic-insensitive search across title, artists, aliases. */
  async search(query) {
    const q = normalizeSearch(query).trim();
    if (!q) return [];
    const terms = q.split(/\s+/).map((t) => (ALIAS_MAP[t] ? normalizeSearch(ALIAS_MAP[t]) : t));
    const tracks = await musicService.getAllTracks();
    return tracks
      .map((track) => ({ track, score: scoreTrack(track, terms) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.track);
  },

  async getRecentSearches() {
    return loadJSON(STORAGE_KEYS.recentSearches, []);
  },

  async addRecentSearch(query) {
    const q = query.trim();
    if (!q) return this.getRecentSearches();
    const current = await this.getRecentSearches();
    const next = [q, ...current.filter((s) => s.toLowerCase() !== q.toLowerCase())].slice(0, MAX_RECENTS);
    await saveJSON(STORAGE_KEYS.recentSearches, next);
    return next;
  },
};

export default searchService;
