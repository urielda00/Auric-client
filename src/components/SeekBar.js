import React, { useState } from "react";
import { View, StyleSheet } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { LinearGradient } from "expo-linear-gradient";
import { runOnJS } from "react-native-reanimated";
import { gradients } from "../constants/theme";

const { physicalSeekRatio } = require("../features/player/playerUxPolicy.cjs");

/** Tap- or drag-to-seek progress bar used by the Full Player. */
export default function SeekBar({ pct, onSeek, height = 4, thumbSize = 12 }) {
  const [width, setWidth] = useState(0);
  const [dragRatio, setDragRatio] = useState(null);

  const previewAtX = (x) => {
    const ratio = physicalSeekRatio(x, width);
    if (ratio !== null) setDragRatio(ratio);
  };
  const commitAtX = (x) => {
    const ratio = physicalSeekRatio(x, width);
    setDragRatio(null);
    if (ratio !== null) onSeek(ratio);
  };
  const clearPreview = () => setDragRatio(null);

  const pan = Gesture.Pan()
    .minDistance(4)
    .onUpdate((e) => runOnJS(previewAtX)(e.x))
    .onEnd((e) => runOnJS(commitAtX)(e.x))
    .onFinalize((_event, success) => {
      if (!success) runOnJS(clearPreview)();
    });
  const tap = Gesture.Tap().onEnd((e) => runOnJS(commitAtX)(e.x));
  const gesture = Gesture.Race(pan, tap);
  const rawDisplayPct = dragRatio === null ? pct : dragRatio * 100;
  const displayPct = Math.max(0, Math.min(100, rawDisplayPct || 0));

  return (
    <GestureDetector gesture={gesture}>
      <View
        style={styles.hitStrip}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      >
        <View style={[styles.track, { height }]}>
          <LinearGradient
            colors={gradients.progress}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.fill, { width: `${displayPct}%` }]}
          />
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <View
              style={[styles.thumbPosition, { width: `${displayPct}%` }]}
            >
              <View
                style={[
                  styles.thumb,
                  {
                    width: thumbSize,
                    height: thumbSize,
                    borderRadius: thumbSize / 2,
                    transform: [{ translateX: thumbSize / 2 }],
                  },
                ]}
              />
            </View>
          </View>
        </View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  hitStrip: {
    height: 22,
    justifyContent: "center",
    direction: "ltr",
  },
  track: {
    width: "100%",
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.13)",
  },
  fill: {
    height: "100%",
    borderRadius: 3,
  },
  thumbPosition: {
    height: "100%",
    alignItems: "flex-end",
    justifyContent: "center",
  },
  thumb: {
    backgroundColor: "#fff",
    boxShadow: "0px 2px 8px rgba(0,0,0,0.5)",
    elevation: 4,
  },
});
