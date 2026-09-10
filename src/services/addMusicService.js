import { musicService } from './musicService';
import { trackArt } from '../utils/artwork';
import { apiConfig } from './apiConfig';

const { createApiClient } = require('./apiClient.cjs');
const { createAddMusicApi } = require('./addMusicApi.cjs');

export const STATUS_STEPS = ['Queued', 'Downloading', 'Processing', 'Ready'];
const STEP_DELAY_MS = 1200;
const ALLOWED_FIELDS = new Set([
  'source_url', 'title', 'artists', 'version', 'album', 'release_year',
  'genre', 'duration_ms', 'search_aliases', 'search_keywords',
]);

const addMusicApi = apiConfig.useServer
  ? createAddMusicApi(createApiClient({
      baseUrl: apiConfig.baseUrl,
      timeoutMs: apiConfig.timeoutMs,
    }))
  : null;

export const AI_INSTRUCTIONS = `You are helping me add one song to my personal music library, Auric.
Reply with ONLY one JSON object (no prose and no markdown fences) shaped exactly like:

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

Use a YouTube video URL. Preserve artist order. Fill every field; use null for
unknown optional scalar values and [] for unknown aliases or keywords. Do not add
IDs, filenames, hashes, source_video_id, storage paths, or media_files data.`;

function requiredText(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Missing required field: ${field}`);
  }
  return value.trim();
}

function nullableText(value, field) {
  if (value === null) return null;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} must be text or null`);
  }
  return value.trim();
}

function textArray(value, field, { required = false } = {}) {
  if (!Array.isArray(value) || (required && value.length === 0)) {
    throw new Error(`${field} must be ${required ? 'a non-empty' : 'an'} array`);
  }
  if (value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${field} must contain only non-empty text`);
  }
  return value.map((item) => item.trim());
}

function normalizeInput(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Expected a single JSON object.');
  }
  const unknown = Object.keys(raw).filter((key) => !ALLOWED_FIELDS.has(key));
  if (unknown.length) throw new Error(`Unknown field: ${unknown[0]}`);
  const sourceUrl = requiredText(raw.source_url, 'source_url');
  let url;
  try {
    url = new URL(sourceUrl);
  } catch {
    throw new Error('source_url must be a valid YouTube URL');
  }
  const allowedHosts = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be'];
  if (!allowedHosts.includes(url.hostname.toLowerCase())) {
    throw new Error('source_url must be a YouTube URL');
  }
  if (raw.release_year !== null && (!Number.isInteger(raw.release_year) || raw.release_year < 1 || raw.release_year > 9999)) {
    throw new Error('release_year must be a valid year or null');
  }
  if (raw.duration_ms !== null && (!Number.isInteger(raw.duration_ms) || raw.duration_ms <= 0)) {
    throw new Error('duration_ms must be a positive integer or null');
  }
  return {
    sourceUrl,
    title: requiredText(raw.title, 'title'),
    artists: textArray(raw.artists, 'artists', { required: true }),
    version: nullableText(raw.version, 'version'),
    album: nullableText(raw.album, 'album'),
    releaseYear: raw.release_year,
    genre: nullableText(raw.genre, 'genre'),
    durationMs: raw.duration_ms,
    searchAliases: textArray(raw.search_aliases, 'search_aliases'),
    searchKeywords: textArray(raw.search_keywords, 'search_keywords'),
  };
}

function serverPayload(input) {
  return {
    source_url: input.sourceUrl,
    title: input.title,
    artists: input.artists,
    version: input.version,
    album: input.album,
    release_year: input.releaseYear,
    genre: input.genre,
    duration_ms: input.durationMs,
    search_aliases: input.searchAliases,
    search_keywords: input.searchKeywords,
  };
}

async function runMockFlow(input, onJob, signal) {
  for (const status of ['queued', 'downloading', 'processing', 'ready']) {
    if (signal?.aborted) throw signal.reason;
    onJob?.({ status, canRetry: false });
    if (status !== 'ready') {
      await new Promise((resolve) => setTimeout(resolve, STEP_DELAY_MS));
    }
  }
  const track = await musicService.addTrack(input);
  return { job: { status: 'ready', trackId: track.id }, track };
}

export const addMusicService = {
  parseAndValidate(jsonText) {
    let raw;
    try {
      raw = JSON.parse(jsonText);
    } catch (error) {
      throw new Error(`Couldn't parse JSON: ${error.message}`);
    }
    const input = normalizeInput(raw);
    return {
      input,
      preview: {
        title: input.title,
        artists: input.artists.join(', '),
        version: input.version || 'Original mix',
        art: trackArt(input.title, input.artists.join(', ')),
        rows: [
          { k: 'Album', v: input.album || '—' },
          { k: 'Year', v: input.releaseYear ? String(input.releaseYear) : '—' },
          { k: 'Source', v: input.sourceUrl },
        ],
      },
    };
  },

  async runAddFlow(input, onJob, signal) {
    if (!addMusicApi) return runMockFlow(input, onJob, signal);
    const job = await addMusicApi.submit(serverPayload(input), onJob, signal);
    const track = job.status === 'ready' && job.trackId
      ? await musicService.getTrackById(job.trackId)
      : null;
    return { job, track };
  },

  async retry(jobId, onJob, signal) {
    if (!addMusicApi) throw new Error('Mock imports do not need retry');
    const job = await addMusicApi.retry(jobId, onJob, signal);
    const track = job.status === 'ready' && job.trackId
      ? await musicService.getTrackById(job.trackId)
      : null;
    return { job, track };
  },
};

export default addMusicService;
