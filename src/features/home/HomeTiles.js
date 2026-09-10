import React from 'react';
import { Pressable, View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { HistoryGlyph } from '../../components/icons/Glyphs';

export default function HomeTiles({ likedCount }) {
  const router = useRouter();
  return (
    <View style={styles.grid}>
      <Pressable onPress={() => router.push('/liked')} style={[styles.tile, styles.likedTile]}>
        <View style={[styles.iconTile, { backgroundColor: 'rgba(239,166,198,0.16)' }]}>
          <Text style={{ fontSize: 16, color: '#EFA6C6' }}>♥</Text>
        </View>
        <Text style={styles.tileTitle}>Liked Songs</Text>
        <Text style={styles.tileSub}>{likedCount} tracks</Text>
      </Pressable>

      <Pressable onPress={() => router.push('/history')} style={[styles.tile, styles.historyTile]}>
        <View style={[styles.iconTile, { backgroundColor: 'rgba(90,209,224,0.14)' }]}>
          <HistoryGlyph />
        </View>
        <Text style={styles.tileTitle}>History</Text>
        <Text style={styles.tileSub}>Last 30 days</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 18,
    paddingBottom: 28,
  },
  tile: {
    flex: 1,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
  },
  likedTile: {
    backgroundColor: 'rgba(239,166,198,0.08)',
    borderColor: 'rgba(239,166,198,0.18)',
  },
  historyTile: {
    backgroundColor: 'rgba(90,209,224,0.07)',
    borderColor: 'rgba(90,209,224,0.16)',
  },
  iconTile: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileTitle: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 14.5,
    color: '#EDEDF2',
    marginTop: 14,
  },
  tileSub: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 11,
    color: '#7A7A8E',
    marginTop: 6,
  },
});
