/** Formatting + text-normalization helpers shared across screens and services. */

const { normalizeSearch } = require('./searchNormalization.cjs');

/** ms -> "3:41" */
export function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Unicode-aware, case-folded, punctuation-insensitive search key. */
export { normalizeSearch };

export function joinArtists(artists) {
  return (artists || []).join(', ');
}

/** "Neon Provinces" + optional version -> "Neon Provinces (Sped Up)" */
export function trackDisplayTitle(track) {
  if (!track) return '';
  return track.version ? `${track.title} (${track.version})` : track.title;
}

export function formatHoursMinutes(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = Math.round(totalMinutes % 60);
  return `${h}h ${m}m`;
}

/** Relative "when" label used by History rows: "18:42" for today, weekday otherwise. */
export function formatClock(date) {
  const h = date.getHours();
  const m = date.getMinutes();
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
