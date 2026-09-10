import React, { useCallback, useState } from 'react';
import { Text, StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, useAnimatedScrollHandler, withTiming, runOnJS } from 'react-native-reanimated';

const MAX_PULL = 84;
const RELEASE_THRESHOLD = 56;
const SETTLE_HEIGHT = 44;
const MIN_REFRESH_MS = 1100;

/**
 * Home's pull-to-refresh, ported from the approved design's custom drag behavior: content
 * translates at 0.55x finger delta up to 84dp, with a text label (not a spinner) that reads
 * "Pull to refresh" -> "Release to refresh" past the threshold -> "Refreshing" while the
 * mock refresh runs.
 */
export default function PullToRefreshScrollView({ onRefresh, children, contentContainerStyle, style, ...scrollProps }) {
  const pullHeight = useSharedValue(0);
  const scrollY = useSharedValue(0);
  const [label, setLabel] = useState('Pull to refresh');
  const [refreshing, setRefreshing] = useState(false);

  const updateLabel = useCallback((h, isRefreshing) => {
    if (isRefreshing) setLabel('Refreshing');
    else setLabel(h > RELEASE_THRESHOLD ? 'Release to refresh' : 'Pull to refresh');
  }, []);

  const finishRefresh = useCallback(() => {
    setRefreshing(false);
    pullHeight.value = withTiming(0, { duration: 220 });
  }, [pullHeight]);

  const beginRefresh = useCallback(() => {
    setRefreshing(true);
    const startedAt = Date.now();
    Promise.resolve(onRefresh?.()).finally(() => {
      const elapsed = Date.now() - startedAt;
      const wait = Math.max(0, MIN_REFRESH_MS - elapsed);
      setTimeout(finishRefresh, wait);
    });
  }, [onRefresh, finishRefresh]);

  const scrollHandler = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });

  // The ScrollView keeps its own native scroll responder (via Animated.ScrollView) — that
  // responder is represented here as `nativeGesture` so our custom Pan can be declared
  // *simultaneous* with it instead of competing for the touch. Without this, Android's
  // gesture-handler treats them as exclusive recognizers and the Pan (which has no
  // direction constraints of its own) wins, silently blocking vertical scrolling —
  // content past a certain point becomes unreachable even though it's still in the tree.
  const nativeGesture = Gesture.Native();

  const pan = Gesture.Pan()
    .simultaneousWithExternalGesture(nativeGesture)
    // Only engage once the drag is clearly vertical, and bail immediately on horizontal
    // movement so nested horizontal lists (e.g. the Quick Picks carousel) keep working.
    .activeOffsetY([-10, 10])
    .failOffsetX([-12, 12])
    .onUpdate((e) => {
      if (scrollY.value > 0 || e.translationY <= 0) return;
      pullHeight.value = Math.min(MAX_PULL, e.translationY * 0.55);
      runOnJS(updateLabel)(pullHeight.value, false);
    })
    .onEnd(() => {
      if (pullHeight.value > RELEASE_THRESHOLD) {
        pullHeight.value = withTiming(SETTLE_HEIGHT, { duration: 160 });
        runOnJS(updateLabel)(0, true);
        runOnJS(beginRefresh)();
      } else {
        pullHeight.value = withTiming(0, { duration: 160 });
      }
    });

  const headerStyle = useAnimatedStyle(() => ({ height: pullHeight.value }));

  return (
    <GestureDetector gesture={Gesture.Simultaneous(pan, nativeGesture)}>
      <Animated.ScrollView
        style={[styles.flex, style]}
        contentContainerStyle={contentContainerStyle}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        overScrollMode="never"
        bounces={false}
        showsVerticalScrollIndicator={false}
        {...scrollProps}
      >
        <Animated.View style={[styles.pullHeader, headerStyle]}>
          <Text style={styles.pullLabel}>{refreshing ? 'Refreshing' : label}</Text>
        </Animated.View>
        {children}
      </Animated.ScrollView>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  // Without an explicit flex, a ScrollView inside a flex column sizes itself to its own
  // content (like a plain View) instead of the available viewport — on Android that means
  // scrollable range collapses to ~0 and the list stops well short of its last content.
  flex: {
    flex: 1,
  },
  pullHeader: {
    justifyContent: 'flex-end',
    alignItems: 'center',
    overflow: 'hidden',
  },
  pullLabel: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 9.5,
    letterSpacing: 1.9,
    textTransform: 'uppercase',
    color: '#8B8BA0',
    paddingBottom: 9,
  },
});
