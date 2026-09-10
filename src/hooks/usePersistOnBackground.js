import { useEffect } from 'react';
import { AppState } from 'react-native';
import { usePlayerStore } from '../stores/usePlayerStore';

/** Flushes playback position to disk the moment the app leaves the foreground. */
export function usePersistOnBackground() {
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'background' || nextState === 'inactive') {
        usePlayerStore.getState().persistNow();
      }
    });
    return () => subscription.remove();
  }, []);
}

export default usePersistOnBackground;
