import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import IconButton from '../../components/IconButton';
import { SearchGlyph, StatsGlyph, PlusGlyph } from '../../components/icons/Glyphs';
import { gradients } from '../../constants/theme';

export default function HomeHeader() {
  const router = useRouter();
  return (
    <View style={styles.row}>
      <View style={styles.brand}>
        <LinearGradient colors={gradients.logoMark} start={{ x: 0.15, y: 0 }} end={{ x: 0.9, y: 1 }} style={styles.logoDot} />
        <Text style={styles.wordmark}>AURIC</Text>
      </View>
      <View style={styles.actions}>
        <IconButton onPress={() => router.push('/search')} accessibilityLabel="Search">
          <SearchGlyph />
        </IconButton>
        <IconButton onPress={() => router.push('/stats')} accessibilityLabel="Stats">
          <StatsGlyph />
        </IconButton>
        <IconButton onPress={() => router.push('/add')} accessibilityLabel="Add music">
          <PlusGlyph />
        </IconButton>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logoDot: {
    width: 26,
    height: 26,
    borderRadius: 9,
    boxShadow: '0px 0px 11px rgba(167,140,240,0.45)',
    elevation: 6,
  },
  wordmark: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 17,
    letterSpacing: 4.08,
    color: '#EDEDF2',
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
});
