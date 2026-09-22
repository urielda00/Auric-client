import React, { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import AmbientGlow from "../../components/AmbientGlow";
import PullToRefreshScrollView from "../../components/PullToRefreshScrollView";
import { colors } from "../../constants/theme";
import { useTabBarBottomInset } from "../../hooks/useBottomContentInset";
import { recommendationService } from "../../services/recommendationService";
import { statsService } from "../../services/statsService";
import { useLibraryStore } from "../../stores/useLibraryStore";
import { usePlayerStore } from "../../stores/usePlayerStore";
import HomeHeader from "./HomeHeader";
import HomeTiles from "./HomeTiles";
import QuickPicksSection from "./QuickPicksSection";
import SmartShuffleBanner from "./SmartShuffleBanner";

const {
  createLatestRequestGate,
  freshQuickPicksSeed,
} = require("../../services/recommendationApi.cjs");
const { getLocalGreeting } = require("./getLocalGreeting.cjs");
const { playTrackFromList } = require("../../services/pressInteraction.cjs");

const pickIds = (data) => [...(data?.cards || []), ...(data?.rows || [])].map((item) => item.track.id);

export default function HomeScreen() {
  const router = useRouter();
  const [picks, setPicks] = useState(null);
  const seedRef = useRef(0);
  const [refreshing, setRefreshing] = useState(false);
  const [picksStatus, setPicksStatus] = useState("idle");
  const [stats, setStats] = useState(null);
  const requestGate = useRef(createLatestRequestGate());
  const activeRequest = useRef(null);
  const playTrackFromContext = usePlayerStore((state) => state.playTrackFromContext);
  const likedIds = useLibraryStore((state) => state.likedIds);
  const toggleLike = useLibraryStore((state) => state.toggleLike);
  const tracksHydrated = useLibraryStore((state) => state.hydrated);

  const loadPicks = useCallback(async (nextSeed, { freshOnly = false, excludeTrackIds = [] } = {}) => {
    const generation = requestGate.current.begin();
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    if (typeof __DEV__ !== "undefined" && __DEV__) console.debug("[AuricHome] refresh request", { seed: nextSeed, freshOnly, excludeTrackIds });
    setPicksStatus((status) =>
      status === "idle" || status === "error" ? "loading" : status,
    );
    try {
      const data = await recommendationService.getQuickPicks(nextSeed, {
        signal: controller.signal,
        freshOnly,
        excludeTrackIds,
      });
      if (typeof __DEV__ !== "undefined" && __DEV__) console.debug("[AuricHome] refresh response", { seed: nextSeed, cached: data.cached, trackIds: pickIds(data) });
      if (!requestGate.current.isCurrent(generation)) {
        if (typeof __DEV__ !== "undefined" && __DEV__) console.debug("[AuricHome] response ignored", { seed: nextSeed, reason: "stale request" });
        return;
      }
      useLibraryStore
        .getState()
        .cacheTracks([
          ...data.cards.map((item) => item.track),
          ...data.rows.map((item) => item.track),
        ]);
      setPicks(data);
      setPicksStatus(data.cached ? "cached" : "success");
    } catch (error) {
      if (typeof __DEV__ !== "undefined" && __DEV__) console.debug("[AuricHome] refresh failed", { seed: nextSeed, code: error?.code || error?.message });
      if (typeof __DEV__ !== "undefined" && __DEV__ && error?.status === 422 && excludeTrackIds.length) {
        console.error("[AuricHome] server rejected refresh exclusions; check deployed recommendation contract", { seed: nextSeed, status: error.status, excludedIds: excludeTrackIds });
      }
      if (
        requestGate.current.isCurrent(generation) &&
        !controller.signal.aborted
      ) {
        setPicksStatus("error");
      }
    }
  }, []);

  useEffect(() => {
    if (typeof __DEV__ !== "undefined" && __DEV__ && picks) {
      console.debug("[AuricHome] visible picks committed", { trackIds: pickIds(picks) });
    }
  }, [picks]);

  useEffect(() => {
    const gate = requestGate.current;
    let cancelled = false;
    if (tracksHydrated) {
      void (async () => {
        const [cachedPicks, cachedStats] = await Promise.all([
          recommendationService.getCachedQuickPicks(),
          statsService.getCachedStats(),
        ]);
        if (cancelled) return;
        if (cachedPicks) {
          useLibraryStore
            .getState()
            .cacheTracks([
              ...cachedPicks.cards.map((item) => item.track),
              ...cachedPicks.rows.map((item) => item.track),
            ]);
          setPicks(cachedPicks);
          setPicksStatus("cached");
        }
        if (cachedStats) setStats(cachedStats);
        const nextSeed = freshQuickPicksSeed(seedRef.current);
        seedRef.current = nextSeed;
        void loadPicks(nextSeed, { freshOnly: true, excludeTrackIds: pickIds(cachedPicks) });
        void statsService
          .getStats()
          .then((freshStats) => {
            if (!cancelled) setStats(freshStats);
          })
          .catch(() => {});
      })();
    }
    return () => {
      cancelled = true;
      gate.invalidate();
      activeRequest.current?.abort();
    };
    // Load a new server set after showing any cached picks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracksHydrated]);

  const handleRefresh = useCallback(async () => {
    if (typeof __DEV__ !== "undefined" && __DEV__) console.debug("[AuricHome] refresh fired", { currentIds: pickIds(picks) });
    setRefreshing(true);
    const nextSeed = freshQuickPicksSeed(seedRef.current);
    seedRef.current = nextSeed;
    try {
      await loadPicks(nextSeed, { freshOnly: true, excludeTrackIds: pickIds(picks) });
    } finally {
      setRefreshing(false);
    }
  }, [loadPicks, picks]);

  const handlePlay = useCallback(
    (track) => playTrackFromList({
      track,
      tracks: [...(picks?.cards || []), ...(picks?.rows || [])].map((item) => item.track),
      context: { type: "quick_pick", label: "Quick Picks" },
      playTrackFromContext,
    }),
    [playTrackFromContext, picks],
  );
  const bottomInset = useTabBarBottomInset();

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <AmbientGlow />
      <PullToRefreshScrollView
        onRefresh={handleRefresh}
        contentContainerStyle={{ paddingBottom: bottomInset }}
      >
        <HomeHeader />
        <View style={styles.greetingBlock}>
          <Text style={styles.greeting}>
            {refreshing ? "Finding something new…" : getLocalGreeting()}
          </Text>
          <Text style={styles.greetingSub}>
            {stats
              ? `${stats.libraryTrackCount.toLocaleString("en-US")} songs · ${stats.listeningLabel} listened`
              : "Your library, tuned to you"}
          </Text>
        </View>

        <QuickPicksSection
          picks={picks}
          status={picksStatus}
          onRetry={handleRefresh}
          likedIds={likedIds}
          onPlay={handlePlay}
          onToggleLike={toggleLike}
        />
        <SmartShuffleBanner onPress={() => router.push("/shuffle")} />
        <HomeTiles likedCount={likedIds.length} />
      </PullToRefreshScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  greetingBlock: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 18,
    alignItems: "flex-start",
    direction: "ltr",
  },
  greeting: {
    alignSelf: "stretch",
    fontFamily: "SpaceGrotesk_600SemiBold",
    fontSize: 27,
    lineHeight: 30,
    letterSpacing: -0.4,
    color: colors.text,
    textAlign: "left",
    writingDirection: "ltr",
  },
  greetingSub: {
    alignSelf: "stretch",
    fontFamily: "Manrope_500Medium",
    fontSize: 12.5,
    color: colors.textFaint,
    marginTop: 8,
    textAlign: "left",
    writingDirection: "ltr",
  },
});
