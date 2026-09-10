import React, { useState } from "react";
import { View, StyleSheet } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { LinearGradient } from "expo-linear-gradient";
import { runOnJS } from "react-native-reanimated";
import { gradients } from "../constants/theme";

/** Tap- or drag-to-seek progress bar used by the Full Player. */
export default function SeekBar({ pct, onSeek, height = 4, thumbSize = 12 }) {
  const [width, setWidth] = useState(0);
  const [dragRatio, setDragRatio] = useState(null);

  const ratioAtX = (x) => {
    if (width <= 0) return;
    return Math.max(0, Math.min(1, x / width));
  };

  const previewAtX = (x) => {
    const ratio = ratioAtX(x);
    if (ratio !== undefined) setDragRatio(ratio);
  };
  const commitAtX = (x) => {
    const ratio = ratioAtX(x);
    setDragRatio(null);
    if (ratio !== undefined) onSeek(ratio);
  };

  const pan = Gesture.Pan()
    .onUpdate((e) => runOnJS(previewAtX)(e.x))
    .onEnd((e) => runOnJS(commitAtX)(e.x));
  const tap = Gesture.Tap().onEnd((e) => runOnJS(commitAtX)(e.x));
  const gesture = Gesture.Race(pan, tap);
  const displayPct = dragRatio === null ? pct : dragRatio * 100;

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
          <View
            style={[
              styles.thumb,
              {
                width: thumbSize,
                height: thumbSize,
                borderRadius: thumbSize / 2,
                left: `${displayPct}%`,
              },
            ]}
          />
        </View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  hitStrip: {
    height: 22,
    justifyContent: "center",
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
  thumb: {
    position: "absolute",
    top: "50%",
    marginTop: -6,
    marginLeft: -6,
    backgroundColor: "#fff",
    boxShadow: "0px 2px 8px rgba(0,0,0,0.5)",
    elevation: 4,
  },
});
