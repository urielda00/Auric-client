import React, { memo, useCallback, useMemo, useRef } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import TrackArt from "../../components/TrackArt";
import { GrabHandle, RemoveGlyph } from "../../components/icons/Glyphs";
import { colors } from "../../constants/theme";
import { trackDisplayTitle, joinArtists } from "../../utils/format";

const {
  createQueueDragCoordinator,
} = require("./dragReorderPolicy.cjs");

const ROW_HEIGHT = 62;
const ROW_GAP = 2;
const SLOT = ROW_HEIGHT + ROW_GAP;

/** Upcoming rows: body swipes scroll; only the three-bar handle can start reorder. */
function DraggableQueueList({
  items,
  onReorder,
  onPlay,
  onRemove,
}) {
  const activeEntryId = useSharedValue(null);
  const activeStartIndex = useSharedValue(-1);
  const dragY = useSharedValue(0);
  const itemsRef = useRef(items);
  const onReorderRef = useRef(onReorder);
  itemsRef.current = items;
  onReorderRef.current = onReorder;

  const coordinatorRef = useRef(null);
  if (!coordinatorRef.current) {
    coordinatorRef.current = createQueueDragCoordinator({
      getEntryIds: () => itemsRef.current.map((item) => item.id),
      onCommit: (entryId, targetEntryId, placement) =>
        onReorderRef.current(entryId, targetEntryId, placement),
    });
  }

  const itemIds = useMemo(() => items.map((item) => item.id), [items]);
  const count = items.length;
  const handleDragStart = useCallback(
    (entryId, snapshot) => coordinatorRef.current.begin(entryId, snapshot),
    [],
  );
  const handleDragEnd = useCallback(
    (targetIndex) => coordinatorRef.current.finish(targetIndex),
    [],
  );
  const handleDragCancel = useCallback(
    () => coordinatorRef.current.cancel(),
    [],
  );
  if (!count) return null;

  return (
    <View style={{ height: count * SLOT - ROW_GAP }}>
      {items.map((item, index) => (
        <QueueRow
          key={item.id}
          item={item}
          index={index}
          count={count}
          itemIds={itemIds}
          activeEntryId={activeEntryId}
          activeStartIndex={activeStartIndex}
          dragY={dragY}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
          onPlay={onPlay}
          onRemove={onRemove}
        />
      ))}
    </View>
  );
}

const QueueRow = memo(function QueueRow({
  item,
  index,
  count,
  itemIds,
  activeEntryId,
  activeStartIndex,
  dragY,
  onDragStart,
  onDragEnd,
  onDragCancel,
  onPlay,
  onRemove,
}) {
  const pan = Gesture.Pan()
    .activeOffsetY([-7, 7])
    .failOffsetX([-24, 24])
    .onStart(() => {
      activeEntryId.value = item.id;
      activeStartIndex.value = index;
      dragY.value = 0;
      runOnJS(onDragStart)(item.id, itemIds);
    })
    .onUpdate((event) => {
      dragY.value = event.translationY;
    })
    .onEnd(() => {
      const target = Math.max(
        0,
        Math.min(
          count - 1,
          Math.round((activeStartIndex.value * SLOT + dragY.value) / SLOT),
        ),
      );
      runOnJS(onDragEnd)(target);
    })
    .onFinalize((_event, success) => {
      dragY.value = withTiming(0, { duration: 160 });
      activeEntryId.value = null;
      activeStartIndex.value = -1;
      if (!success) runOnJS(onDragCancel)();
    });

  const animatedStyle = useAnimatedStyle(() => {
    const activeId = activeEntryId.value;
    const active = activeStartIndex.value;
    if (activeId === null || active < 0) {
      return {
        transform: [{ translateY: withTiming(0, { duration: 140 }) }],
        zIndex: 0,
        opacity: 1,
      };
    }
    if (activeId === item.id) {
      return {
        transform: [{ translateY: dragY.value }],
        zIndex: 10,
        opacity: 0.92,
      };
    }
    const target = Math.max(
      0,
      Math.min(
        count - 1,
        Math.round((active * SLOT + dragY.value) / SLOT),
      ),
    );
    let shift = 0;
    if (active < target && index > active && index <= target) shift = -SLOT;
    else if (active > target && index >= target && index < active) shift = SLOT;
    return {
      transform: [{ translateY: withTiming(shift, { duration: 140 }) }],
      zIndex: 0,
      opacity: 1,
    };
  });

  return (
    <Animated.View
      style={[
        styles.row,
        { top: index * SLOT, height: ROW_HEIGHT },
        animatedStyle,
      ]}
    >
      <GestureDetector gesture={pan}>
        <View
          accessibilityLabel={`Reorder ${trackDisplayTitle(item.track)}`}
          accessibilityRole="adjustable"
          style={styles.handle}
          hitSlop={8}
        >
          <GrabHandle />
        </View>
      </GestureDetector>

      <Pressable onPress={() => onPlay(item)} style={styles.main}>
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

      <Pressable
        onPress={() => onRemove(item)}
        style={styles.actionBtn}
        hitSlop={4}
      >
        <RemoveGlyph />
      </Pressable>
    </Animated.View>
  );
});

export default memo(DraggableQueueList);

const styles = StyleSheet.create({
  row: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 6,
    borderRadius: 15,
    backgroundColor: "transparent",
  },
  handle: {
    width: 30,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  main: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontFamily: "Manrope_600SemiBold",
    fontSize: 13,
    color: colors.text,
  },
  artist: {
    fontFamily: "Manrope_500Medium",
    fontSize: 11,
    color: colors.textMute,
    marginTop: 2.5,
  },
  actionBtn: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.05)",
    alignItems: "center",
    justifyContent: "center",
  },
});
