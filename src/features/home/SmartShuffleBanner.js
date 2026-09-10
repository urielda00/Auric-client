import React from 'react';
import { Pressable, View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { PlayTriangle } from '../../components/icons/Glyphs';
import { gradients } from '../../constants/theme';

export default function SmartShuffleBanner({ onPress }) {
  return (
    <Pressable onPress={onPress} style={styles.pressable}>
      <LinearGradient
        colors={gradients.smartShuffle}
        locations={gradients.smartShuffleLocations}
        start={{ x: 0.05, y: 0.1 }}
        end={{ x: 0.95, y: 0.9 }}
        style={styles.card}
      >
        <View style={styles.glow} />
        <View style={styles.content}>
          <View style={styles.playTile}>
            <PlayTriangle size={13} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Smart Shuffle</Text>
            <Text style={styles.subtitle}>{"Play something I'll probably enjoy"}</Text>
          </View>
        </View>
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    paddingHorizontal: 18,
    paddingBottom: 14,
  },
  card: {
    borderRadius: 22,
    padding: 20,
    overflow: 'hidden',
  },
  glow: {
    position: 'absolute',
    right: -40,
    top: -60,
    width: 190,
    height: 190,
    borderRadius: 95,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  playTile: {
    width: 46,
    height: 46,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 17,
    color: '#fff',
  },
  subtitle: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 11.5,
    color: 'rgba(255,255,255,0.72)',
    marginTop: 5,
  },
});
