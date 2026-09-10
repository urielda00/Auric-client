import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import PullToRefreshScrollView from '../../components/PullToRefreshScrollView';
import AmbientGlow from '../../components/AmbientGlow';
import { useTabBarBottomInset } from '../../hooks/useBottomContentInset';
import HomeHeader from './HomeHeader';
import QuickPicksSection from './QuickPicksSection';
import SmartShuffleBanner from './SmartShuffleBanner';
import HomeTiles from './HomeTiles';
import { recommendationService } from '../../services/recommendationService';
import { usePlayerStore } from '../../stores/usePlayerStore';
import { useLibraryStore } from '../../stores/useLibraryStore';
import { colors } from '../../constants/theme';

export default function HomeScreen() {
  const router = useRouter();
  const [picks, setPicks] = useState(null);
  const [seed, setSeed] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const play = usePlayerStore((s) => s.play);
  const likedIds = useLibraryStore((s) => s.likedIds);
  const toggleLike = useLibraryStore((s) => s.toggleLike);
  const tracksHydrated = useLibraryStore((s) => s.hydrated);

  const loadPicks = useCallback(async (nextSeed) => {
    const data = await recommendationService.getQuickPicks(nextSeed);
    setPicks(data);
  }, []);

  useEffect(() => {
    if (tracksHydrated) loadPicks(seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracksHydrated]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    const nextSeed = seed + 1;
    setSeed(nextSeed);
    await loadPicks(nextSeed);
    setRefreshing(false);
  }, [seed, loadPicks]);

  const handlePlay = useCallback((track, source) => play(track.id, { type: source === 'Quick Picks' ? 'quickPicks' : 'home', label: source }), [play]);
  const bottomInset = useTabBarBottomInset();

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <AmbientGlow />
      <PullToRefreshScrollView onRefresh={handleRefresh} contentContainerStyle={[styles.content, { paddingBottom: styles.content.paddingBottom + bottomInset }]}>
        <HomeHeader />
        <View style={styles.greetingBlock}>
          <Text style={styles.greeting}>{refreshing ? 'Finding something new…' : 'Good evening, Uriel.'}</Text>
          <Text style={styles.greetingSub}>1,684 songs · 41h this year</Text>
        </View>

        <QuickPicksSection picks={picks} likedIds={likedIds} onPlay={handlePlay} onToggleLike={toggleLike} />

        <SmartShuffleBanner onPress={() => router.push('/shuffle')} />

        <HomeTiles likedCount={likedIds.length} />
      </PullToRefreshScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    paddingBottom: 8,
  },
  greetingBlock: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 18,
  },
  greeting: {
    fontFamily: 'SpaceGrotesk_600SemiBold',
    fontSize: 27,
    lineHeight: 30,
    letterSpacing: -0.4,
    color: colors.text,
  },
  greetingSub: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 12.5,
    color: colors.textFaint,
    marginTop: 8,
  },
});
