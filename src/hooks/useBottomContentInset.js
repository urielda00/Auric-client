import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLayoutMetricsStore } from '../stores/useLayoutMetricsStore';

/**
 * The one place that decides how much bottom clearance a scrollable screen needs so its
 * last item never sits under the Mini Player / tab bar / gesture-nav area. Two flavors,
 * because the Mini Player lives in two different places depending on the screen:
 *
 *  - `useTabBarBottomInset` — for screens inside the bottom-tabs navigator (Home, Search).
 *    The custom tab bar renders the Mini Player stacked above the tab row and reports its
 *    own *total* rendered height (Mini Player + tab row + safe area) via onLayout, so this
 *    is the only number needed — it's already 0-vs-nonzero correct depending on whether a
 *    track is loaded.
 *
 *  - `useMiniPlayerBottomInset` — for pushed screens outside the tabs navigator
 *    (Liked, History, Stats, Add Music) that render their own local `<MiniPlayer/>`.
 *    Nothing else on those screens reserves the safe area, so it's added explicitly.
 *
 * Both add a small fixed visual gap on top, so content never sits flush against the player.
 */
export const CONTENT_BOTTOM_GAP = 16;

export function useTabBarBottomInset(extraGap = CONTENT_BOTTOM_GAP) {
  const tabBarHeight = useLayoutMetricsStore((s) => s.tabBarHeight);
  return tabBarHeight + extraGap;
}

export function useMiniPlayerBottomInset(measuredMiniPlayerHeight, extraGap = CONTENT_BOTTOM_GAP) {
  const insets = useSafeAreaInsets();
  return measuredMiniPlayerHeight + insets.bottom + extraGap;
}
