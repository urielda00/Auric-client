import { create } from 'zustand';

/**
 * Small shared store for real, measured layout metrics that multiple unrelated screens
 * need but that only one component can actually observe directly.
 *
 * `tabBarHeight` is the *only* thing kept here: the full rendered height of the custom
 * bottom tab bar (which already contains the Mini Player stacked above the tab row, see
 * `AppTabBar`), measured live via onLayout. It is set only by `AppTabBar` and read only by
 * the two screens that actually sit inside the tabs navigator (Home, Search) — pushed
 * screens (Liked/History/Stats/Add) never read it, so a stale value from a
 * still-mounted-but-unfocused tab screen can never leak into an unrelated screen's layout.
 */
export const useLayoutMetricsStore = create((set) => ({
  tabBarHeight: 0,
  setTabBarHeight: (height) => set((state) => (state.tabBarHeight === height ? state : { tabBarHeight: height })),
}));

export default useLayoutMetricsStore;
