import React, { useEffect, useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Defs, RadialGradient, LinearGradient, Stop, Rect, Circle } from 'react-native-svg';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, withSequence, Easing } from 'react-native-reanimated';
import EqualizerBars from '../../components/EqualizerBars';
import { trackArt } from '../../utils/artwork';
import { PatternOverlay } from '../../components/TrackArtPattern';

/**
 * The full player's animated cover: the static generated-art gradient underneath two
 * slowly drifting color blobs, a rotating ring with a marker dot, the track's initial
 * letter, and a 4-bar equalizer that stills when paused. Timings/positions ported from
 * the approved design's `fA`/`fB`/`spin`/`eq` keyframes.
 */
export default function AnimatedTrackArt({ track, size, playing }) {
  const art = useMemo(() => trackArt(track?.title || '?', (track?.artists || []).join(', '), track?.visualSeed ?? track?.id), [track]);

  const blobA = useSharedValue(0);
  const blobB = useSharedValue(0);
  const ring = useSharedValue(0);

  useEffect(() => {
    blobA.value = withRepeat(withSequence(withTiming(1, { duration: 6500, easing: Easing.inOut(Easing.ease) }), withTiming(0, { duration: 6500, easing: Easing.inOut(Easing.ease) })), -1, false);
    blobB.value = withRepeat(withSequence(withTiming(1, { duration: 8500, easing: Easing.inOut(Easing.ease) }), withTiming(0, { duration: 8500, easing: Easing.inOut(Easing.ease) })), -1, false);
    ring.value = withRepeat(withTiming(1, { duration: 44000, easing: Easing.linear }), -1, false);
    // blobA/blobB/ring are Reanimated shared values — stable across renders by design, and
    // intentionally excluded so this loop restarts only when the track itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id]);

  const blobAStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: blobA.value * size * 0.16 },
      { translateY: blobA.value * size * -0.12 },
      { scale: 1 + blobA.value * 0.2 },
    ],
  }));
  const blobBStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: blobB.value * size * -0.18 },
      { translateY: blobB.value * size * 0.14 },
      { scale: 1.15 - blobB.value * 0.25 },
    ],
  }));
  const ringStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${ring.value * 360}deg` }] }));

  const blobSize = size * 0.68;

  return (
    <View style={{ width: size, height: size, borderRadius: 36, overflow: 'hidden', backgroundColor: art.deep }}>
      <Svg width={size} height={size} viewBox="0 0 100 100" style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="base" x1="15%" y1="0%" x2="55%" y2="100%">
            <Stop offset="0" stopColor={art.base} />
            <Stop offset="1" stopColor={art.deep} />
          </LinearGradient>
          <RadialGradient id="ba" cx="18%" cy="12%" rx="80%" ry="75%" gradientUnits="objectBoundingBox">
            <Stop offset="0" stopColor={art.blobA} stopOpacity="1" />
            <Stop offset="0.62" stopColor={art.blobA} stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="bb" cx="88%" cy="86%" rx="75%" ry="72%" gradientUnits="objectBoundingBox">
            <Stop offset="0" stopColor={art.blobB} stopOpacity="1" />
            <Stop offset="0.66" stopColor={art.blobB} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect width="100" height="100" fill="url(#base)" />
        <Rect width="100" height="100" fill="url(#bb)" />
        <Rect width="100" height="100" fill="url(#ba)" />
      </Svg>

      <Animated.View style={[styles.blob, { width: blobSize, height: blobSize, left: -size * 0.06, top: -size * 0.08 }, blobAStyle]}>
        <BlobCircle color={art.blobA} />
      </Animated.View>
      <Animated.View style={[styles.blob, { width: blobSize, height: blobSize, right: -size * 0.08, bottom: -size * 0.06 }, blobBStyle]}>
        <BlobCircle color={art.blobB} />
      </Animated.View>

      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <PatternOverlay pattern={art.pattern} />
      </View>

      <Animated.View style={[styles.ring, { left: size * 0.14, top: size * 0.14, right: size * 0.14, bottom: size * 0.14 }, ringStyle]}>
        <View style={styles.ringDot} />
      </Animated.View>

      <View style={styles.letterWrap} pointerEvents="none">
        <Text style={[styles.letter, { fontSize: size * 0.42 }]}>{art.letter}</Text>
      </View>

      <View style={[styles.eqWrap, { opacity: playing ? 1 : 0.25 }]} pointerEvents="none">
        <EqualizerBars bars={4} active={playing} />
      </View>
    </View>
  );
}

function BlobCircle({ color }) {
  return (
    <Svg width="100%" height="100%" viewBox="0 0 100 100">
      <Defs>
        <RadialGradient id="blob" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={color} stopOpacity="0.95" />
          <Stop offset="0.7" stopColor={color} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Circle cx="50" cy="50" r="50" fill="url(#blob)" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  blob: {
    position: 'absolute',
    borderRadius: 9999,
  },
  ring: {
    position: 'absolute',
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  ringDot: {
    position: 'absolute',
    top: -3.5,
    left: '50%',
    marginLeft: -3.5,
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: 'rgba(255,255,255,0.75)',
  },
  letterWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  letter: {
    fontFamily: 'SpaceGrotesk_700Bold',
    color: 'rgba(255,255,255,0.2)',
    letterSpacing: -2,
  },
  eqWrap: {
    position: 'absolute',
    left: 22,
    bottom: 20,
  },
});
