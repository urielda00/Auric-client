import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import ScreenHeader from '../../components/ScreenHeader';
import { Eyebrow } from '../../components/Typography';
import MiniPlayer from '../player/MiniPlayer';
import AmbientGlow from '../../components/AmbientGlow';
import { statsService } from '../../services/statsService';
import { useLibraryStore } from '../../stores/useLibraryStore';
import { useMeasuredHeight } from '../../hooks/useMeasuredHeight';
import { useMiniPlayerBottomInset } from '../../hooks/useBottomContentInset';
import { colors, gradients } from '../../constants/theme';
import { trackDisplayTitle } from '../../utils/format';

// Rough "waking hours elapsed this year" used only for the hero card's human-readable line.
const WAKING_HOURS_SO_FAR = 200 * 16;

export default function StatsScreen() {
  const [stats, setStats] = useState(null);
  const history = useLibraryStore((s) => s.history);
  const likedIds = useLibraryStore((s) => s.likedIds);

  useEffect(() => {
    statsService.getStats().then(setStats);
  }, [history, likedIds]);

  const [miniPlayerHeight, onMiniPlayerLayout] = useMeasuredHeight();
  const bottomInset = useMiniPlayerBottomInset(miniPlayerHeight);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <AmbientGlow />
      <ScreenHeader title="Your year so far" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: styles.content.paddingBottom + bottomInset }]}
        showsVerticalScrollIndicator={false}
      >
        {stats ? (
          <>
            <LinearGradient colors={gradients.statsHero} locations={gradients.statsHeroLocations} start={{ x: 0.05, y: 0 }} end={{ x: 0.9, y: 1 }} style={styles.hero}>
              <View style={styles.heroGlow} />
              <Eyebrow color="rgba(255,255,255,0.6)">Listening time</Eyebrow>
              <Text style={styles.heroNumber}>{stats.listeningLabel}</Text>
              <Text style={styles.heroCaption}>≈ {Math.max(1, Math.round(stats.listeningMinutes / WAKING_HOURS_SO_FAR))} minutes of every hour awake</Text>
            </LinearGradient>

            <View style={styles.tileGrid}>
              {stats.tiles.map((tile) => (
                <View key={tile.label} style={styles.tile}>
                  <Text style={[styles.tileValue, { color: tile.color }]}>{tile.value}</Text>
                  <Text style={styles.tileLabel}>{tile.label}</Text>
                </View>
              ))}
            </View>

            <View style={styles.section}>
              <Eyebrow style={{ marginBottom: 14, letterSpacing: 1.7 }}>Most played</Eyebrow>
              <View style={{ gap: 13 }}>
                {stats.topTracks.map(({ track, rank, plays, pct }) => (
                  <View key={track.id} style={styles.topRow}>
                    <Text style={styles.rank}>{rank}</Text>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={styles.topHeadRow}>
                        <Text style={styles.topTitle} numberOfLines={1}>
                          {trackDisplayTitle(track)}
                        </Text>
                        <Text style={styles.topPlays}>{plays} plays</Text>
                      </View>
                      <View style={styles.barTrack}>
                        <LinearGradient colors={['#8A5CD8', '#5AD1E0']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.barFill, { width: `${pct}%` }]} />
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            </View>

            <View style={[styles.section, { paddingBottom: 30 }]}>
              <Eyebrow style={{ marginBottom: 12, letterSpacing: 1.7 }}>Rediscovered lately</Eyebrow>
              {stats.rediscovered.length ? (
                <View style={styles.chipRow}>
                  {stats.rediscovered.map((track) => (
                    <View key={track.id} style={styles.chip}>
                      <Text style={styles.chipLabel}>{trackDisplayTitle(track)}</Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.emptyText}>{"Play something you haven't heard in a while — it'll show up here."}</Text>
              )}
            </View>
          </>
        ) : null}
      </ScrollView>
      <View onLayout={onMiniPlayerLayout}>
        <MiniPlayer />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingBottom: 12,
  },
  hero: {
    marginHorizontal: 18,
    marginTop: 22,
    borderRadius: 24,
    padding: 22,
    overflow: 'hidden',
  },
  heroGlow: {
    position: 'absolute',
    left: -30,
    bottom: -70,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  heroNumber: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 46,
    letterSpacing: -1.4,
    color: colors.text,
    marginTop: 14,
  },
  heroCaption: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 12,
    color: 'rgba(255,255,255,0.66)',
    marginTop: 12,
  },
  tileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    paddingHorizontal: 18,
    paddingTop: 12,
  },
  tile: {
    width: '47.4%',
    borderRadius: 18,
    padding: 16,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  tileValue: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 24,
    letterSpacing: -0.4,
  },
  tileLabel: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 11,
    color: colors.textMute,
    marginTop: 9,
  },
  section: {
    paddingHorizontal: 18,
    paddingTop: 26,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rank: {
    width: 15,
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 12,
    color: '#54546A',
  },
  topHeadRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
  },
  topTitle: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 12.5,
    color: colors.text,
    flexShrink: 1,
  },
  topPlays: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 12.5,
    color: colors.textMute,
  },
  barTrack: {
    height: 5,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginTop: 7,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 3,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 13,
    backgroundColor: 'rgba(90,209,224,0.09)',
    borderWidth: 1,
    borderColor: 'rgba(90,209,224,0.18)',
  },
  chipLabel: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 12,
    color: colors.cyanLight,
  },
  emptyText: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 12.5,
    lineHeight: 20,
    color: colors.textFaint,
  },
});
