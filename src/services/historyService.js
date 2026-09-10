import { loadJSON, saveJSON, STORAGE_KEYS } from './storage';
import { generateId } from '../utils/id';
import { formatClock, WEEKDAY_LABELS } from '../utils/format';

const MAX_ENTRIES = 300;

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function dayLabel(date) {
  const now = new Date();
  const today = startOfDay(now);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekStart = new Date(today);
  weekStart.setDate(weekStart.getDate() - 6);
  const d = startOfDay(date);

  if (d.getTime() === today.getTime()) return 'Today';
  if (d.getTime() === yesterday.getTime()) return 'Yesterday';
  if (d.getTime() >= weekStart.getTime()) return 'Earlier this week';
  return 'Earlier';
}

function whenLabel(date) {
  const label = dayLabel(date);
  if (label === 'Today' || label === 'Yesterday') return formatClock(date);
  return WEEKDAY_LABELS[date.getDay()];
}

const GROUP_ORDER = ['Today', 'Yesterday', 'Earlier this week', 'Earlier'];

export const historyService = {
  async getEntries() {
    return loadJSON(STORAGE_KEYS.history, []);
  },

  /** Records a play event for the given track id. Called whenever playback starts a track. */
  async recordPlay(trackId) {
    const entries = await this.getEntries();
    const next = [{ id: generateId('hist'), trackId, playedAt: new Date().toISOString() }, ...entries].slice(0, MAX_ENTRIES);
    await saveJSON(STORAGE_KEYS.history, next);
    return next;
  },

  async clear() {
    await saveJSON(STORAGE_KEYS.history, []);
    return [];
  },

  /**
   * Groups raw entries into { label, items: [{ entryId, trackId, when }] } buckets,
   * in Today / Yesterday / Earlier this week / Earlier order, empty buckets omitted.
   */
  groupEntries(entries) {
    const buckets = new Map();
    for (const entry of entries) {
      const date = new Date(entry.playedAt);
      const label = dayLabel(date);
      if (!buckets.has(label)) buckets.set(label, []);
      buckets.get(label).push({ entryId: entry.id, trackId: entry.trackId, when: whenLabel(date) });
    }
    return GROUP_ORDER.filter((label) => buckets.has(label)).map((label) => ({ label, items: buckets.get(label) }));
  },
};

export default historyService;
