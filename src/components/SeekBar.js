import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { LinearGradient } from 'expo-linear-gradient';
import { runOnJS } from 'react-native-reanimated';
import { gradients } from '../constants/theme';

/** Tap- or drag-to-seek progress bar used by the Full Player. */
export default function SeekBar({ pct, onSeek, height = 4, thumbSize = 12 }) {
  const [width, setWidth] = useState(0);

  const seekAtX = (x) => {
    if (width <= 0) return;
    const ratio = Math.max(0, Math.min(1, x / width));
    onSeek(ratio);
  };

  const pan = Gesture.Pan()
    .onUpdate((e) => runOnJS(seekAtX)(e.x))
    .onEnd((e) => runOnJS(seekAtX)(e.x));
  const tap = Gesture.Tap().onEnd((e) => runOnJS(seekAtX)(e.x));
  const gesture = Gesture.Race(pan, tap);

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.hitStrip} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        <View style={[styles.track, { height }]}>
          <LinearGradient colors={gradients.progress} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.fill, { width: `${pct}%` }]} />
          <View style={[styles.thumb, { width: thumbSize, height: thumbSize, borderRadius: thumbSize / 2, left: `${pct}%` }]} />
        </View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  hitStrip: {
    height: 22,
    justifyContent: 'center',
  },
  track: {
    width: '100%',
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.13)',
  },
  fill: {
    height: '100%',
    borderRadius: 3,
  },
  thumb: {
    position: 'absolute',
    top: '50%',
    marginTop: -6,
    marginLeft: -6,
    backgroundColor: '#fff',
    boxShadow: '0px 2px 8px rgba(0,0,0,0.5)',
    elevation: 4,
  },
});
