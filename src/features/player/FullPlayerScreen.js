import React, { useCallback, useEffect, useMemo } from "react";
import { View, Text, Pressable, StyleSheet, Dimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import IconButton from "../../components/IconButton";
import SeekBar from "../../components/SeekBar";
import {
  DownChevron,
  QueueGlyph,
  PrevGlyph,
  NextGlyph,
  PauseBars,
  PlayTriangle,
} from "../../components/icons/Glyphs";
import AnimatedTrackArt from "./AnimatedTrackArt";
import { usePlayerStore } from "../../stores/usePlayerStore";
import { useLibraryStore } from "../../stores/useLibraryStore";
import { colors, shadows } from "../../constants/theme";
import {
  formatDuration,
  trackDisplayTitle,
  joinArtists,
} from "../../utils/format";
import { trackArt } from "../../utils/artwork";

const {
  createQueueSwipeReleaseHandler,
} = require("./queueSwipe.cjs");

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const ART_SIZE = Math.min(SCREEN_WIDTH - 60, 420);

export default function FullPlayerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const positionMs = usePlayerStore((s) => s.positionMs);
  const durationMs = usePlayerStore((s) => s.durationMs);
  const isBuffering = usePlayerStore((s) => s.isBuffering);
  const playbackError = usePlayerStore((s) => s.playbackError);
  const playbackContext = usePlayerStore((s) => s.playbackContext);
  const toggle = usePlayerStore((s) => s.toggle);
  const seek = usePlayerStore((s) => s.seek);
  const next = usePlayerStore((s) => s.next);
  const previous = usePlayerStore((s) => s.previous);
  const retry = usePlayerStore((s) => s.retry);
  const track = useLibraryStore((s) =>
    currentTrackId ? s.tracksById[currentTrackId] : null,
  );
  const isLiked = useLibraryStore((s) =>
    currentTrackId ? s.likedIds.includes(currentTrackId) : false,
  );
  const toggleLike = useLibraryStore((s) => s.toggleLike);
  const openQueue = useCallback(() => router.push("/queue"), [router]);
  const releaseQueueSwipe = useMemo(
    () => createQueueSwipeReleaseHandler(openQueue),
    [openQueue],
  );
  const queueSwipe = Gesture.Pan()
    .activeOffsetY([-12, 12])
    .failOffsetX([-20, 20])
    .onEnd((event) => {
      runOnJS(releaseQueueSwipe)(
        event.translationX,
        event.translationY,
        event.velocityY,
      );
    });

  const ambient = useMemo(
    () =>
      track
        ? trackArt(track.title, track.artists.join(", "), track.visualSeed)
        : null,
    [track],
  );

  useEffect(() => {
    if (!track) router.back();
  }, [track, router]);

  if (!track) return null;

  const pct =
    durationMs > 0 ? Math.min(100, (positionMs / durationMs) * 100) : 0;

  return (
    <View style={styles.screen}>
      {ambient ? (
        <View
          pointerEvents="none"
          style={[styles.ambient, { backgroundColor: ambient.blobA }]}
        />
      ) : null}

      <View style={[styles.topBar, { paddingTop: Math.max(16, insets.top) }]}>
        <IconButton
          size={38}
          radius={13}
          background={colors.surface3}
          border="transparent"
          onPress={() => router.back()}
        >
          <DownChevron />
        </IconButton>
        <Text style={styles.sourceLabel}>
          {playbackContext?.label?.toUpperCase() || ""}
        </Text>
        <IconButton
          size={38}
          radius={13}
          background={colors.surface3}
          border="transparent"
          onPress={openQueue}
        >
          <QueueGlyph />
        </IconButton>
      </View>

      <View style={styles.artZone}>
        <View style={shadows.playerArt}>
          <AnimatedTrackArt track={track} size={ART_SIZE} playing={isPlaying} />
        </View>
      </View>

      <View style={styles.titleRow}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title} numberOfLines={1}>
            {trackDisplayTitle(track)}
          </Text>
          <Text style={styles.artist} numberOfLines={1}>
            {joinArtists(track.artists)}
          </Text>
        </View>
        <Pressable
          onPress={() => toggleLike(track.id)}
          style={[
            styles.likeBtn,
            isLiked && {
              backgroundColor: "rgba(239,166,198,0.14)",
              borderColor: "rgba(239,166,198,0.3)",
            },
          ]}
        >
          <Text
            style={{
              fontSize: 19,
              color: isLiked ? colors.pink : colors.textDim,
            }}
          >
            {isLiked ? "♥" : "♡"}
          </Text>
        </Pressable>
      </View>

      <View style={styles.progressZone}>
        <SeekBar
          pct={pct}
          onSeek={(ratio) => seek(Math.round(ratio * durationMs))}
        />
        <View style={styles.timeRow}>
          <Text style={styles.timeText}>{formatDuration(positionMs)}</Text>
          <Text style={styles.timeText}>{formatDuration(durationMs)}</Text>
        </View>
        {playbackError ? (
          <Pressable onPress={retry} style={styles.errorRow}>
            <Text style={styles.errorText}>{playbackError}</Text>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        ) : isBuffering ? (
          <Text style={styles.bufferingText}>Buffering…</Text>
        ) : null}
      </View>

      <GestureDetector gesture={queueSwipe}>
        <View style={styles.queuePullZone}>
          <View style={styles.queuePullHandle} />
          <Text style={styles.queuePullLabel}>QUEUE</Text>
        </View>
      </GestureDetector>

      <View
        style={[
          styles.transport,
          { paddingBottom: Math.max(24, insets.bottom + 10) },
        ]}
      >
        <Pressable onPress={previous} style={styles.sideBtn} hitSlop={8}>
          <PrevGlyph />
        </Pressable>
        <Pressable onPress={toggle} style={styles.playBtn}>
          {isPlaying ? (
            <PauseBars height={26} width={5} gap={7} />
          ) : (
            <PlayTriangle size={22} color="#0B0B10" />
          )}
        </Pressable>
        <Pressable onPress={next} style={styles.sideBtn} hitSlop={8}>
          <NextGlyph />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  ambient: {
    position: "absolute",
    left: "-30%",
    right: "-30%",
    top: 0,
    height: "45%",
    opacity: 0.35,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingBottom: 8,
  },
  sourceLabel: {
    fontFamily: "Manrope_700Bold",
    fontSize: 9.5,
    letterSpacing: 1.9,
    color: colors.textDim,
  },
  artZone: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 30,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 14,
    paddingHorizontal: 26,
    paddingTop: 22,
    paddingBottom: 8,
  },
  title: {
    fontFamily: "SpaceGrotesk_600SemiBold",
    fontSize: 25,
    lineHeight: 29,
    letterSpacing: -0.5,
    color: colors.text,
  },
  artist: {
    fontFamily: "Manrope_500Medium",
    fontSize: 13.5,
    color: colors.textDim,
    marginTop: 8,
  },
  likeBtn: {
    width: 46,
    height: 46,
    borderRadius: 16,
    backgroundColor: colors.surface3,
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: "center",
    justifyContent: "center",
  },
  progressZone: {
    paddingHorizontal: 26,
    paddingTop: 16,
  },
  timeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 6,
  },
  timeText: {
    fontFamily: "Manrope_500Medium",
    fontSize: 11,
    color: colors.textMute,
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginTop: 10,
  },
  errorText: {
    flex: 1,
    fontFamily: "Manrope_500Medium",
    fontSize: 11,
    color: colors.textMute,
  },
  retryText: {
    fontFamily: "Manrope_700Bold",
    fontSize: 11,
    color: colors.violet,
  },
  bufferingText: {
    marginTop: 10,
    fontFamily: "Manrope_500Medium",
    fontSize: 11,
    color: colors.textMute,
  },
  transport: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 34,
    paddingTop: 8,
  },
  queuePullZone: {
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  queuePullHandle: {
    width: 34,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  queuePullLabel: {
    fontFamily: "Manrope_700Bold",
    fontSize: 8,
    letterSpacing: 1.5,
    color: colors.textFaint,
  },
  sideBtn: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  playBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.playButton,
  },
});
