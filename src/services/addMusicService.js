import { musicService } from './musicService';
import { trackArt } from '../utils/artwork';

/**
 * Mock "Add Music" pipeline. Parses the metadata JSON a user would get from an AI
 * assistant, previews it, then simulates the Queued -> Downloading -> Processing -> Ready
 * lifecycle a real download/transcode would go through on the home server. No network
 * calls, no files — `runAddFlow` just waits and then inserts the track into musicService.
 */

export const STATUS_STEPS = ['Queued', 'Downloading', 'Processing', 'Ready'];
const STEP_DELAY_MS = 1200;

export const AI_INSTRUCTIONS = `You are helping me add a song to my personal music library, Auric.
Reply with ONLY a JSON object (no prose, no markdown fences) shaped like:

{
  "source_url": "https://www.youtube.com/watch?v=...",
  "title": "Song Name",
  "artists": ["Artist Name"],
  "version": null,
  "album": null,
  "release_year": null,
  "genre": null,
  "duration_ms": 210000,
  "search_aliases": [],
  "search_keywords": []
}

Fill in every field you can determine; use null for anything unknown. "title" and
"artists" are required.`;

function normalizeInput(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Expected a single JSON object.');
  }
  if (!raw.title || typeof raw.title !== 'string' || !raw.title.trim()) {
    throw new Error('Missing required field: title');
  }
  const artists = Array.isArray(raw.artists) && raw.artists.length ? raw.artists.filter(Boolean) : [];
  if (!artists.length) {
    throw new Error('Missing required field: artists');
  }
  return {
    sourceUrl: raw.source_url || null,
    title: raw.title.trim(),
    artists,
    version: raw.version || null,
    album: raw.album || null,
    releaseYear: raw.release_year || null,
    genre: raw.genre || null,
    durationMs: typeof raw.duration_ms === 'number' && raw.duration_ms > 0 ? raw.duration_ms : 210000,
    searchAliases: Array.isArray(raw.search_aliases) ? raw.search_aliases : [],
    searchKeywords: Array.isArray(raw.search_keywords) ? raw.search_keywords : [],
  };
}

export const addMusicService = {
  /** Parses + validates the pasted JSON, throwing a user-facing Error on failure. */
  parseAndValidate(jsonText) {
    let raw;
    try {
      raw = JSON.parse(jsonText);
    } catch (e) {
      throw new Error(`Couldn't parse JSON: ${e.message}`);
    }
    const input = normalizeInput(raw);
    const art = trackArt(input.title, input.artists.join(', '));
    const preview = {
      title: input.title,
      artists: input.artists.join(', '),
      version: input.version ? input.version : 'Original mix',
      art,
      rows: [
        { k: 'Album', v: input.album || '—' },
        { k: 'Year', v: input.releaseYear ? String(input.releaseYear) : '—' },
        { k: 'Source', v: input.sourceUrl || '—' },
      ],
    };
    return { input, preview };
  },

  /**
   * Simulates the download/processing lifecycle, calling `onStep(index)` for each of
   * STATUS_STEPS as it's reached, then inserts the track into the library once Ready.
   */
  async runAddFlow(input, onStep) {
    for (let i = 0; i < STATUS_STEPS.length; i++) {
      onStep?.(i);
      if (i < STATUS_STEPS.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, STEP_DELAY_MS));
      }
    }
    return musicService.addTrack(input);
  },
};

export default addMusicService;
