import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { usePlayerStore } from '../stores/usePlayerStore';
import { useLibraryStore } from '../stores/useLibraryStore';
import { trackArt } from '../utils/artwork';

/**
 * The soft color wash bleeding from the top of every non-modal screen, tinted by whatever
 * is currently playing. Ported from the approved design's `ambient` gradient (there, a
 * real CSS blur; here, two large low-opacity blobs approximate the same effect since RN
 * has no blur-filter primitive for arbitrary views).
 */
export default function AmbientGlow() {
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  const track = useLibraryStore((s) => (currentTrackId ? s.tracksById[currentTrackId] : null));

  const art = useMemo(() => {
    if (!track) return null;
    return trackArt(track.title, track.artists.join(', '), track.visualSeed ?? track.id);
  }, [track]);

  if (!art) return null;

  return (
    <View pointerEvents="none" style={styles.wrap}>
      <View style={[styles.blob, { backgroundColor: art.blobA, left: '10%', top: -60 }]} />
      <View style={[styles.blob, { backgroundColor: art.blobB, right: '5%', top: -40 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 300,
    overflow: 'hidden',
  },
  blob: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: 130,
    opacity: 0.16,
  },
});
