import { useEffect, useState } from 'react';
import { useLibraryStore } from '../stores/useLibraryStore';
import { useQueueStore } from '../stores/useQueueStore';
import { usePlayerStore } from '../stores/usePlayerStore';

/**
 * Rehydrates every store from local persistence, in dependency order: the library must be
 * loaded before the queue/player can resolve track ids back into track objects.
 */
export function useAppHydration() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await useLibraryStore.getState().hydrate();
      await useQueueStore.getState().hydrate();
      await usePlayerStore.getState().hydrate();
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return ready;
}

export default useAppHydration;
