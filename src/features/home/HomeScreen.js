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
} = require("../../services/recommendationApi.cjs");

export default function HomeScreen() {
  const router = useRouter();
  const [picks, setPicks] = useState(null);
  const [seed, setSeed] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [picksStatus, setPicksStatus] = useState("idle");
  const [stats, setStats] = useState(null);
  const requestGate = useRef(createLatestRequestGate());
  const activeRequest = useRef(null);
  const play = usePlayerStore((state) => state.play);
  const likedIds = useLibraryStore((state) => state.likedIds);
  const toggleLike = useLibraryStore((state) => state.toggleLike);
  const tracksHydrated = useLibraryStore((state) => state.hydrated);

  const loadPicks = useCallback(async (nextSeed) => {
    const generation = requestGate.current.begin();
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setPicksStatus("loading");
    try {
      const data = await recommendationService.getQuickPicks(nextSeed, {
        signal: controller.signal,
      });
      if (!requestGate.current.isCurrent(generation)) return;
      useLibraryStore
        .getState()
        .cacheTracks([
          ...data.cards.map((item) => item.track),
          ...data.rows.map((item) => item.track),
        ]);
      setPicks(data);
      setPicksStatus(data.cached ? "cached" : "success");
    } catch {
      if (
        requestGate.current.isCurrent(generation) &&
        !controller.signal.aborted
      ) {
        setPicksStatus("error");
      }
    }
  }, []);

  useEffect(() => {
    const gate = requestGate.current;
    if (tracksHydrated) {
      loadPicks(seed);
      statsService
        .getStats()
        .then(setStats)
        .catch(() => {});
    }
    return () => {
      gate.invalidate();
      activeRequest.current?.abort();
    };
    // The first load deliberately uses the initial seed only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracksHydrated]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    const nextSeed = seed + 1;
    setSeed(nextSeed);
    try {
      await loadPicks(nextSeed);
    } finally {
      setRefreshing(false);
    }
  }, [seed, loadPicks]);

  const handlePlay = useCallback(
    (track) => play(track.id, { type: "quick_pick", label: "Quick Picks" }),
    [play],
  );
  const bottomInset = useTabBarBottomInset();

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <AmbientGlow />
      <PullToRefreshScrollView
        onRefresh={handleRefresh}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: styles.content.paddingBottom + bottomInset },
        ]}
      >
        <HomeHeader />
        <View style={styles.greetingBlock}>
          <Text style={styles.greeting}>
            {refreshing ? "Finding something new…" : "Good evening, Uriel."}
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
          onRetry={() => loadPicks(seed)}
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
  content: { paddingBottom: 8 },
  greetingBlock: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 18,
  },
  greeting: {
    fontFamily: "SpaceGrotesk_600SemiBold",
    fontSize: 27,
    lineHeight: 30,
    letterSpacing: -0.4,
    color: colors.text,
  },
  greetingSub: {
    fontFamily: "Manrope_500Medium",
    fontSize: 12.5,
    color: colors.textFaint,
    marginTop: 8,
  },
});
