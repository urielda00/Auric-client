import React from 'react';
import { Pressable, View, Text, StyleSheet } from 'react-native';
import TrackArt from './TrackArt';
import { ListTitle, ListSubtitle } from './Typography';
import { colors } from '../constants/theme';
import { trackDisplayTitle, joinArtists } from '../utils/format';

/**
 * The one-line track row reused across Home, Search, Liked Songs and History. Variants are
 * expressed through props rather than separate components, per the approved design (same
 * 46/44dp art + title/subtitle + trailing actions shape everywhere).
 */
export default function TrackRow({
  track,
  subtitle,
  titleColor = colors.text,
  artSize = 46,
  artRadius = 14,
  liked = false,
  onPress,
  onToggleLike,
  onPlayNext,
  showNextPill = false,
}) {
  const displaySubtitle = subtitle ?? joinArtists(track.artists);

  return (
    <View style={styles.row}>
      <Pressable onPress={onPress} style={({ pressed }) => [styles.main, pressed && styles.pressed]}>
        <TrackArt track={track} size={artSize} radius={artRadius} />
        <View style={styles.textCol}>
          <ListTitle color={titleColor}>{trackDisplayTitle(track)}</ListTitle>
          <ListSubtitle style={{ marginTop: 2.5 }}>{displaySubtitle}</ListSubtitle>
        </View>
      </Pressable>

      {showNextPill ? (
        <Pressable onPress={onPlayNext} style={({ pressed }) => [styles.nextPill, pressed && styles.pressed]} hitSlop={4}>
          <Text style={styles.nextLabel}>NEXT</Text>
        </Pressable>
      ) : null}

      {onToggleLike ? (
        <Pressable onPress={onToggleLike} hitSlop={4} style={styles.heartBtn}>
          <Text style={{ fontSize: 15, color: liked ? colors.pink : '#5C5C70' }}>{liked ? '♥' : '♡'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 7,
    paddingHorizontal: 6,
    borderRadius: 15,
  },
  main: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    minWidth: 0,
    borderRadius: 15,
  },
  pressed: {
    backgroundColor: 'rgba(255,255,255,0.045)',
  },
  textCol: {
    flex: 1,
    minWidth: 0,
  },
  nextPill: {
    height: 30,
    paddingHorizontal: 11,
    borderRadius: 10,
    backgroundColor: colors.surface3,
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextLabel: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 10,
    letterSpacing: 0.8,
    color: '#C9C9D6',
  },
  heartBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
