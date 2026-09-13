import { useEffect, useState } from "react";
import { useLibraryStore } from "../stores/useLibraryStore";
import { useQueueStore } from "../stores/useQueueStore";
import { usePlayerStore } from "../stores/usePlayerStore";

/**
 * Rehydrates every store from local persistence, in dependency order: the library must be
 * loaded before the queue/player can resolve track ids back into track objects.
 */
export function useAppHydration(enabled = true) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setReady(false);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        await useLibraryStore.getState().hydrate();
        await useQueueStore.getState().hydrate();
        await usePlayerStore.getState().hydrate();
      } catch {
        // Individual stores/services retain their safe cached state. Auth failures are
        // handled centrally; an offline server must not trap the app on its splash.
      } finally {
        if (!cancelled) {
          setReady(true);
          const library = useLibraryStore.getState();
          void Promise.all([
            library.refreshLibrary(),
            library.refreshLikes(),
            library.refreshHistory(),
            usePlayerStore.getState().reconcileInBackground(),
          ]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return ready;
}

export default useAppHydration;
