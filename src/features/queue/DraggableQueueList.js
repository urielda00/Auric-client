import React, { useRef } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, runOnJS } from 'react-native-reanimated';
import TrackArt from '../../components/TrackArt';
import { GrabHandle, UpChevron, RemoveGlyph } from '../../components/icons/Glyphs';
import { colors } from '../../constants/theme';
import { trackDisplayTitle, joinArtists } from '../../utils/format';

const ROW_HEIGHT = 62;
const ROW_GAP = 2;
const SLOT = ROW_HEIGHT + ROW_GAP;

/**
 * The queue's "Next up" list. Rows drag-reorder from their grab handle (Reanimated +
 * Gesture Handler); the up/remove buttons exist so reordering never depends on discovering
 * the drag gesture, per the approved design.
 */
export default function DraggableQueueList({ items, onReorder, onPlay, onRemove }) {
  const draggingIndex = useSharedValue(-1);
  const dragY = useSharedValue(0);
  const count = items.length;

  if (!count) return null;

  return (
    <View style={{ height: count * SLOT - ROW_GAP }}>
      {items.map((item, index) => (
        <QueueRow
          key={item.id}
          item={item}
          index={index}
          count={count}
          draggingIndex={draggingIndex}
          dragY={dragY}
          onReorder={onReorder}
          onPlay={() => onPlay(item, index)}
          onRemove={() => onRemove(item, index)}
          onMoveUp={index > 0 ? () => onReorder(index, index - 1) : null}
        />
      ))}
    </View>
  );
}

function QueueRow({ item, index, count, draggingIndex, dragY, onReorder, onPlay, onRemove, onMoveUp }) {
  const startIndex = useRef(index);
  startIndex.current = index;

  const commitReorder = (from, to) => {
    if (to !== from) onReorder(from, to);
  };

  const pan = Gesture.Pan()
    .onStart(() => {
      draggingIndex.value = startIndex.current;
      dragY.value = 0;
    })
    .onUpdate((e) => {
      dragY.value = e.translationY;
    })
    .onEnd(() => {
      const from = startIndex.current;
      const target = Math.max(0, Math.min(count - 1, Math.round((from * SLOT + dragY.value) / SLOT)));
      dragY.value = withTiming(0, { duration: 160 });
      draggingIndex.value = -1;
      runOnJS(commitReorder)(from, target);
    });

  const style = useAnimatedStyle(() => {
    const active = draggingIndex.value;
    if (active === -1) {
      return { transform: [{ translateY: withTiming(0, { duration: 140 }) }], zIndex: 0, opacity: 1 };
    }
    if (active === index) {
      return { transform: [{ translateY: dragY.value }], zIndex: 10, opacity: 0.92 };
    }
    const target = Math.max(0, Math.min(count - 1, Math.round((active * SLOT + dragY.value) / SLOT)));
    let shift = 0;
    if (active < target && index > active && index <= target) shift = -SLOT;
    else if (active > target && index >= target && index < active) shift = SLOT;
    return { transform: [{ translateY: withTiming(shift, { duration: 140 }) }], zIndex: 0, opacity: 1 };
  });

  return (
    <Animated.View style={[styles.row, { top: index * SLOT, height: ROW_HEIGHT }, style]}>
      <GestureDetector gesture={pan}>
        <View style={styles.handle} hitSlop={8}>
          <GrabHandle />
        </View>
      </GestureDetector>

      <Pressable onPress={onPlay} style={styles.main}>
        <TrackArt track={item.track} size={42} radius={13} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title} numberOfLines={1}>
            {trackDisplayTitle(item.track)}
          </Text>
          <Text style={styles.artist} numberOfLines={1}>
            {joinArtists(item.track.artists)}
          </Text>
        </View>
      </Pressable>

      {onMoveUp ? (
        <Pressable onPress={onMoveUp} style={styles.actionBtn} hitSlop={4}>
          <UpChevron />
        </Pressable>
      ) : (
        <View style={styles.actionBtn} />
      )}
      <Pressable onPress={onRemove} style={styles.actionBtn} hitSlop={4}>
        <RemoveGlyph />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 6,
    borderRadius: 15,
    backgroundColor: 'transparent',
  },
  handle: {
    width: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  main: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
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
  actionBtn: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
