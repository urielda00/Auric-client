import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import TrackArt from '../../components/TrackArt';
import { PlayTriangle, PauseBars } from '../../components/icons/Glyphs';
import { usePlayerStore } from '../../stores/usePlayerStore';
import { useLibraryStore } from '../../stores/useLibraryStore';
import { colors, gradients, shadows } from '../../constants/theme';
import { trackDisplayTitle, joinArtists } from '../../utils/format';

/**
 * Persistent mini player. Rendered by every non-modal screen; visibility is driven purely
 * by whether a track is loaded (usePlayerStore.currentTrackId), so it survives navigation
 * without any prop plumbing.
 */
export default function MiniPlayer() {
  const router = useRouter();
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const positionMs = usePlayerStore((s) => s.positionMs);
  const durationMs = usePlayerStore((s) => s.durationMs);
  const toggle = usePlayerStore((s) => s.toggle);
  const track = useLibraryStore((s) => (currentTrackId ? s.tracksById[currentTrackId] : null));
  const isLiked = useLibraryStore((s) => (currentTrackId ? s.likedIds.includes(currentTrackId) : false));
  const toggleLike = useLibraryStore((s) => s.toggleLike);

  if (!track) return null;

  const pct = durationMs > 0 ? Math.min(100, (positionMs / durationMs) * 100) : 0;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <BlurView intensity={40} tint="dark" style={styles.card}>
        <View style={styles.row}>
          <Pressable onPress={() => router.push('/player')} style={styles.tapArea}>
            <TrackArt track={track} size={44} radius={14} />
            <View style={styles.textCol}>
              <Text style={styles.title} numberOfLines={1}>
                {trackDisplayTitle(track)}
              </Text>
              <Text style={styles.artist} numberOfLines={1}>
                {joinArtists(track.artists)}
              </Text>
            </View>
          </Pressable>

          <Pressable onPress={() => toggleLike(track.id)} hitSlop={6} style={styles.heartBtn}>
            <Text style={{ fontSize: 15, color: isLiked ? colors.pink : colors.textDim }}>{isLiked ? '♥' : '♡'}</Text>
          </Pressable>

          <Pressable onPress={toggle} style={styles.playBtn}>
            {isPlaying ? <PauseBars /> : <PlayTriangle size={11} color="#0B0B10" />}
          </Pressable>
        </View>

        <View style={styles.progressTrack}>
          <LinearGradient
            colors={gradients.progress}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.progressFill, { width: `${pct}%` }]}
          />
        </View>
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 10,
    paddingBottom: 6,
  },
  card: {
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: 'rgba(22,22,29,0.82)',
    ...shadows.miniPlayer,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 9,
    paddingLeft: 9,
    paddingRight: 12,
  },
  tapArea: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    minWidth: 0,
  },
  textCol: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 13,
    color: colors.text,
  },
  artist: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 11,
    color: colors.textMute,
    marginTop: 2.5,
  },
  heartBtn: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressTrack: {
    height: 2.5,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  progressFill: {
    height: '100%',
  },
});
