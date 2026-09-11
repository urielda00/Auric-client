import React, { useEffect, useMemo } from 'react';
import { ActivityIndicator, View, Text, Pressable, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import ScreenHeader from '../../components/ScreenHeader';
import TrackRow from '../../components/TrackRow';
import MiniPlayer from '../player/MiniPlayer';
import AmbientGlow from '../../components/AmbientGlow';
import { useLibraryStore } from '../../stores/useLibraryStore';
import { usePlayerStore } from '../../stores/usePlayerStore';
import { useMeasuredHeight } from '../../hooks/useMeasuredHeight';
import { useMiniPlayerBottomInset } from '../../hooks/useBottomContentInset';
import { colors, gradients, shadows } from '../../constants/theme';

export default function LikedScreen() {
  const likedIds = useLibraryStore((s) => s.likedIds);
  const tracksById = useLibraryStore((s) => s.tracksById);
  const toggleLike = useLibraryStore((s) => s.toggleLike);
  const likesStatus = useLibraryStore((s) => s.likesStatus);
  const likesError = useLibraryStore((s) => s.likesError);
  const refreshLikes = useLibraryStore((s) => s.refreshLikes);
  const playLikedSongs = usePlayerStore((s) => s.playLikedSongs);
  const shuffleLikedSongs = usePlayerStore((s) => s.shuffleLikedSongs);

  useEffect(() => {
    refreshLikes();
  }, [refreshLikes]);

  const likedTracks = useMemo(() => likedIds.map((id) => tracksById[id]).filter(Boolean), [likedIds, tracksById]);
  // SafeAreaView only reserves the *top* inset here — the bottom safe area is folded into
  // `bottomInset` below so it's applied exactly once, on the scrollable content itself,
  // never doubled up with a `bottom` edge on the SafeAreaView too.
  const [miniPlayerHeight, onMiniPlayerLayout] = useMeasuredHeight();
  const bottomInset = useMiniPlayerBottomInset(miniPlayerHeight);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <AmbientGlow />
      <FlatList
        data={likedTracks}
        keyExtractor={(t) => t.id}
        style={styles.list}
        contentContainerStyle={[styles.listContent, { paddingBottom: styles.listContent.paddingBottom + bottomInset }]}
        refreshing={likesStatus === 'loading'}
        onRefresh={refreshLikes}
        ListHeaderComponent={
          <>
            <ScreenHeader />
            <View style={styles.hero}>
              <LinearGradient colors={gradients.likedCover} locations={gradients.likedCoverLocations} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={styles.cover}>
                <Text style={styles.coverHeart}>♥</Text>
              </LinearGradient>
              <View style={styles.heroText}>
                <Text style={styles.heroTitle}>Liked Songs</Text>
                <Text style={styles.heroSub}>{likedTracks.length} songs · plays as its own set</Text>
              </View>
            </View>

            <View style={styles.actionRow}>
              <Pressable
                onPress={() => shuffleLikedSongs(likedIds)}
                disabled={!likedTracks.length}
                style={[styles.shuffleBtn, !likedTracks.length && styles.disabled]}
              >
                <View style={styles.shuffleGlyph}>
                  <View style={styles.shuffleBar} />
                  <View style={styles.shuffleBar} />
                </View>
                <Text style={styles.shuffleLabel}>Shuffle</Text>
              </Pressable>
              <Pressable
                onPress={() => playLikedSongs(likedIds)}
                disabled={!likedTracks.length}
                style={[styles.playSquare, !likedTracks.length && styles.disabled]}
              >
                <View style={styles.playTriangle} />
              </Pressable>
            </View>
          </>
        }
        renderItem={({ item: track, index }) => (
          <TrackRow
            track={track}
            titleColor={index === 0 ? colors.pinkLight : colors.text}
            liked
            onPress={() =>
              playLikedSongs([
                track.id,
                ...likedIds.filter((id) => id !== track.id),
              ])
            }
            onToggleLike={() => toggleLike(track.id)}
          />
        )}
        ListEmptyComponent={likesStatus === 'loading' ? (
          <View style={styles.emptyState}>
            <ActivityIndicator color={colors.violet} />
          </View>
        ) : likesStatus === 'error' ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>{likesError?.message || 'Could not load Liked Songs.'}</Text>
            <Pressable onPress={refreshLikes} style={styles.retryButton}>
              <Text style={styles.retryLabel}>Retry</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>Nothing liked yet.{'\n'}Tap the heart on any track to build this list.</Text>
          </View>
        )}
      />
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
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 16,
    paddingHorizontal: 6,
    paddingTop: 18,
  },
  cover: {
    width: 96,
    height: 96,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.quickPick,
  },
  coverHeart: {
    fontSize: 34,
    color: 'rgba(255,255,255,0.92)',
  },
  heroText: {
    flex: 1,
    minWidth: 0,
    paddingBottom: 4,
  },
  heroTitle: {
    fontFamily: 'SpaceGrotesk_600SemiBold',
    fontSize: 24,
    letterSpacing: -0.36,
    color: colors.text,
  },
  heroSub: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 12,
    color: colors.textMute,
    marginTop: 9,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 6,
    paddingVertical: 20,
  },
  shuffleBtn: {
    flex: 1,
    height: 52,
    borderRadius: 17,
    backgroundColor: colors.text,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  shuffleGlyph: {
    gap: 3,
  },
  shuffleBar: {
    width: 15,
    height: 1.8,
    backgroundColor: '#0B0B10',
    borderRadius: 2,
  },
  shuffleLabel: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 14,
    color: '#0B0B10',
  },
  playSquare: {
    width: 52,
    height: 52,
    borderRadius: 17,
    backgroundColor: colors.surface3,
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playTriangle: {
    width: 0,
    height: 0,
    borderTopWidth: 7.5,
    borderBottomWidth: 7.5,
    borderLeftWidth: 12,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: colors.text,
    marginLeft: 3,
  },
  disabled: {
    opacity: 0.4,
  },
  emptyState: {
    paddingHorizontal: 24,
    paddingTop: 40,
    alignItems: 'center',
    gap: 12,
  },
  emptyText: {
    textAlign: 'center',
    fontFamily: 'Manrope_500Medium',
    fontSize: 13,
    lineHeight: 21,
    color: colors.textFaint,
  },
  retryButton: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.surface3,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  retryLabel: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 12,
    color: colors.text,
  },
});
