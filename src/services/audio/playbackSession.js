import { audioEngine } from ".";
import { useLibraryStore } from "../../stores/useLibraryStore";
import { useQueueStore } from "../../stores/useQueueStore";
import { usePlayerStore } from "../../stores/usePlayerStore";

let backgroundHydration = null;

async function ensureBackgroundPlaybackState() {
  if (usePlayerStore.getState().hydrated) return;
  if (!backgroundHydration) {
    backgroundHydration = (async () => {
      if (!useLibraryStore.getState().hydrated) {
        await useLibraryStore.getState().hydrate();
      }
      if (!useQueueStore.getState().hydrated) {
        await useQueueStore.getState().hydrate();
      }
      if (!usePlayerStore.getState().hydrated) {
        await usePlayerStore.getState().hydrate({ initializeAudio: false });
      }
    })().finally(() => {
      backgroundHydration = null;
    });
  }
  await backgroundHydration;
}

export async function handleBackgroundPlaybackEvent(event) {
  await ensureBackgroundPlaybackState();
  await audioEngine.handleNativeEvent?.(event);
}
