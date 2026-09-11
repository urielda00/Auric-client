import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

/**
 * Thin persistence boundary. Screens and stores never touch AsyncStorage/SecureStore
 * directly — they go through here, so swapping the backing store later (or adding
 * server-authoritative sync) doesn't ripple through the app.
 */

const NAMESPACE = "auric";
const key = (name) => `${NAMESPACE}:${name}`;

export async function loadJSON(name, fallback = null) {
  try {
    const raw = await AsyncStorage.getItem(key(name));
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export async function saveJSON(name, value) {
  try {
    await AsyncStorage.setItem(key(name), JSON.stringify(value));
  } catch {
    // Best-effort persistence; a write failure should never crash playback/UI.
  }
}

export async function removeJSON(name) {
  try {
    await AsyncStorage.removeItem(key(name));
  } catch {
    // no-op
  }
}

/** Device credentials are the only values stored outside AsyncStorage. */
export const secureAuth = {
  async getToken() {
    try {
      return await SecureStore.getItemAsync(key("authToken"));
    } catch {
      return null;
    }
  },
  async setToken(token) {
    if (token) await SecureStore.setItemAsync(key("authToken"), token);
    else await SecureStore.deleteItemAsync(key("authToken"));
  },
};

export const STORAGE_KEYS = {
  liked: "liked",
  history: "history",
  queue: "queue",
  queueIndex: "queueIndex",
  currentTrack: "currentTrack",
  positionMs: "positionMs",
  playbackContext: "playbackContext",
  shuffleMode: "shuffleMode",
  recentSearches: "recentSearches",
  library: "library",
  pendingListeningSessions: "pendingListeningSessions",
  playbackSnapshot: "playbackSnapshot",
  quickPicks: "quickPicks",
  statsSummary: "statsSummary",
};
