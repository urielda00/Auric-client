import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, withDelay, Easing } from 'react-native-reanimated';

const DELAYS = [0, 350, 700, 150];

function Bar({ height, width, color, delay, active }) {
  const scale = useSharedValue(0.3);

  useEffect(() => {
    if (active) {
      scale.value = withDelay(delay, withRepeat(withTiming(1, { duration: 550, easing: Easing.inOut(Easing.ease) }), -1, true));
    } else {
      scale.value = withTiming(0.3, { duration: 200 });
    }
  }, [active, delay, scale]);

  const style = useAnimatedStyle(() => ({ transform: [{ scaleY: scale.value }] }));

  return (
    <Animated.View
      style={[
        { width, height, backgroundColor: color, borderRadius: 2, transformOrigin: 'bottom' },
        style,
      ]}
    />
  );
}

/** The small 3-4 bar "now playing" equalizer used on the full player and queue card. */
export default function EqualizerBars({ bars = 4, height = 22, width = 3, gap = 3.5, color = 'rgba(255,255,255,0.8)', active = true }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap, height }}>
      {Array.from({ length: bars }).map((_, i) => (
        <Bar key={i} height={height} width={width} color={color} delay={DELAYS[i % DELAYS.length]} active={active} />
      ))}
    </View>
  );
}
