import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  FlatList,
  InteractionManager,
  View,
  Text,
  Pressable,
  StyleSheet,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import TrackArt from "../../components/TrackArt";
import EqualizerBars from "../../components/EqualizerBars";
import { Eyebrow } from "../../components/Typography";
import {
  PauseBars,
  PlayTriangle,
} from "../../components/icons/Glyphs";
import DraggableQueueList from "./DraggableQueueList";
import { usePlayerStore } from "../../stores/usePlayerStore";
import { useQueueStore } from "../../stores/useQueueStore";
import { useLibraryStore } from "../../stores/useLibraryStore";
import { colors } from "../../constants/theme";
import { joinArtists, trackDisplayTitle } from "../../utils/format";

const {
  PLAYED_ROW_HEIGHT,
  createQueuePlaybackControls,
  deriveQueueTimeline,
} = require("./queueTimeline.cjs");
const {
  createQueueDismissReleaseHandler,
} = require("../player/queueSwipe.cjs");

export default function QueueScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  const currentItemId = usePlayerStore((s) => s.currentItemId);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const toggle = usePlayerStore((s) => s.toggle);
  const playQueued = usePlayerStore((s) => s.playQueued);
  const playbackContext = usePlayerStore((s) => s.playbackContext);
  const playedItems = usePlayerStore((s) => s.playedItems);
  const queueEntries = useQueueStore((s) => s.entries);
  const moveEntry = useQueueStore((s) => s.moveEntry);
  const removeEntry = useQueueStore((s) => s.removeEntry);
  const tracksById = useLibraryStore((s) => s.tracksById);
  const [timelineReady, setTimelineReady] = useState(false);

  const timeline = useMemo(
    () =>
      deriveQueueTimeline({
        playedItems,
        currentTrackId,
        currentItemId,
        playbackContext,
        queueEntries,
        tracksById,
      }),
    [
      currentItemId,
      currentTrackId,
      playbackContext,
      playedItems,
      queueEntries,
      tracksById,
    ],
  );
  const controls = useMemo(() => createQueuePlaybackControls(toggle), [toggle]);
  const dismissQueue = useCallback(() => router.back(), [router]);
  const releaseQueueDismiss = useMemo(
    () => createQueueDismissReleaseHandler(dismissQueue),
    [dismissQueue],
  );
  const queueDismissSwipe = Gesture.Pan()
    .activeOffsetY([-6, 6])
    .failOffsetX([-40, 40])
    .onEnd((event) => {
      runOnJS(releaseQueueDismiss)(
        event.translationX,
        event.translationY,
        event.velocityY,
      );
    });

  useEffect(() => {
    // Keep SVG artwork and per-row gestures off the route transition's critical
    // path so the sheet chrome can commit and respond immediately.
    const task = InteractionManager.runAfterInteractions(() => {
      setTimelineReady(true);
    });
    return () => task.cancel();
  }, []);

  const handlePlay = useCallback(
    (item) => {
      playQueued(item.trackId, item.context || playbackContext, item.id);
    },
    [playQueued, playbackContext],
  );

  const handleReorder = useCallback(
    (entryId, targetEntryId, placement) =>
      moveEntry(entryId, targetEntryId, placement),
    [moveEntry],
  );

  const handleRemove = useCallback(
    (item) => removeEntry(item.id),
    [removeEntry],
  );

  const timelineRows = useMemo(
    () => [
      ...timeline.played.map((item) => ({ kind: "played", item })),
      { kind: "active", id: "active-queue" },
    ],
    [timeline.played],
  );

  const renderTimelineRow = ({ item: row }) => {
    if (row.kind === "played") return <PlayedRow item={row.item} />;
    return (
      <ActiveQueue
        current={timeline.current}
        upcoming={timeline.upcoming}
        isPlaying={isPlaying}
        onReorder={handleReorder}
        onPlay={handlePlay}
        onRemove={handleRemove}
      />
    );
  };

  return (
    <View style={styles.scrim}>
      <Pressable
        accessibilityLabel="Close Queue"
        onPress={dismissQueue}
        style={styles.backdrop}
      />
      <View style={styles.sheet}>
        <GestureDetector gesture={queueDismissSwipe}>
          <View style={styles.topChrome}>
            <View style={styles.grabberWrap}>
              <View style={styles.grabber} />
            </View>
            <View style={styles.headerRow}>
              <Text style={styles.headerTitle}>Queue</Text>
              <Pressable onPress={dismissQueue} hitSlop={8}>
                <Text style={styles.playerBtn}>PLAYER</Text>
              </Pressable>
            </View>
          </View>
        </GestureDetector>

        {timeline.current ? (
          <View style={styles.playbackHeader}>
            <TrackArt track={timeline.current.track} size={38} radius={11} />
            <View style={styles.headerTrackText}>
              <Text style={styles.headerTrackTitle} numberOfLines={1}>
                {trackDisplayTitle(timeline.current.track)}
              </Text>
              <Text style={styles.headerArtist} numberOfLines={1}>
                {joinArtists(timeline.current.track.artists)}
              </Text>
            </View>
            <Pressable
              accessibilityLabel={isPlaying ? "Pause" : "Play"}
              onPress={controls.togglePlayback}
              style={styles.headerPlayButton}
              hitSlop={6}
            >
              {isPlaying ? (
                <PauseBars height={15} width={3} gap={4} color={colors.black} />
              ) : (
                <PlayTriangle size={12} color={colors.black} />
              )}
            </Pressable>
          </View>
        ) : null}

        {timelineReady ? (
          <FlatList
            testID="queue-timeline"
            style={styles.timeline}
            data={timelineRows}
            renderItem={renderTimelineRow}
            keyExtractor={(row) =>
              row.kind === "played" ? `played-${row.item.id}` : row.id
            }
            initialScrollIndex={timeline.played.length}
            getItemLayout={(_data, index) => ({
              length: PLAYED_ROW_HEIGHT,
              offset: index * PLAYED_ROW_HEIGHT,
              index,
            })}
            initialNumToRender={6}
            maxToRenderPerBatch={6}
            windowSize={5}
            nestedScrollEnabled
            contentContainerStyle={[
              styles.listContent,
              { paddingBottom: 24 + insets.bottom },
            ]}
            showsVerticalScrollIndicator={false}
          />
        ) : (
          <View testID="queue-timeline-placeholder" style={styles.timeline} />
        )}
      </View>
    </View>
  );
}

const PlayedRow = memo(function PlayedRow({ item }) {
  return (
    <View pointerEvents="none" style={styles.playedRow}>
      <TrackArt track={item.track} size={40} radius={12} />
      <View style={styles.playedText}>
        <Text style={styles.playedTitle} numberOfLines={1}>
          {trackDisplayTitle(item.track)}
        </Text>
        <Text style={styles.playedArtist} numberOfLines={1}>
          {joinArtists(item.track.artists)}
        </Text>
      </View>
      <Text style={styles.playedLabel}>PLAYED</Text>
    </View>
  );
});

const ActiveQueue = memo(function ActiveQueue({
  current,
  upcoming,
  isPlaying,
  onReorder,
  onPlay,
  onRemove,
}) {
  return (
    <>
      {current ? (
        <View style={styles.nowPlayingWrap}>
          <LinearGradient
            colors={["rgba(167,140,240,0.16)", "rgba(90,209,224,0.08)"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.nowPlayingCard}
          >
            <TrackArt track={current.track} size={46} radius={14} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.nowTitle} numberOfLines={1}>
                {trackDisplayTitle(current.track)}
              </Text>
              <Text style={styles.nowEyebrow}>Now playing</Text>
            </View>
            <EqualizerBars
              bars={3}
              height={16}
              width={2.5}
              gap={3}
              color={colors.violetLight}
              active={isPlaying}
            />
          </LinearGradient>
        </View>
      ) : null}

      {upcoming.length ? (
        <Eyebrow style={styles.nextUpLabel}>
          Next up · drag to reorder
        </Eyebrow>
      ) : null}

      {upcoming.length ? (
        <DraggableQueueList
          items={upcoming}
          onReorder={onReorder}
          onPlay={onPlay}
          onRemove={onRemove}
        />
      ) : (
        <Text style={styles.emptyText}>
          {'Nothing queued. Add tracks with "Play Next" or start a shuffle.'}
        </Text>
      )}
    </>
  );
});

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(4,4,7,0.6)",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    height: "92%",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: colors.bgSheet,
    borderTopWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    overflow: "hidden",
  },
  topChrome: {
    minHeight: 76,
  },
  grabberWrap: {
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  grabber: {
    width: 38,
    height: 4,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  headerTitle: {
    fontFamily: "SpaceGrotesk_600SemiBold",
    fontSize: 19,
    letterSpacing: -0.19,
    color: colors.text,
  },
  playerBtn: {
    fontFamily: "Manrope_700Bold",
    fontSize: 11,
    letterSpacing: 1.1,
    color: colors.textDim,
    padding: 8,
  },
  playbackHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 8,
    borderRadius: 15,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  headerTrackText: {
    flex: 1,
    minWidth: 0,
  },
  headerTrackTitle: {
    fontFamily: "Manrope_600SemiBold",
    fontSize: 12.5,
    color: colors.text,
  },
  headerArtist: {
    fontFamily: "Manrope_500Medium",
    fontSize: 10.5,
    color: colors.textMute,
    marginTop: 2,
  },
  headerPlayButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
  },
  timeline: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 24,
  },
  playedRow: {
    height: PLAYED_ROW_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    paddingHorizontal: 6,
    opacity: 0.55,
  },
  playedText: {
    flex: 1,
    minWidth: 0,
  },
  playedTitle: {
    fontFamily: "Manrope_600SemiBold",
    fontSize: 13,
    color: colors.text,
  },
  playedArtist: {
    fontFamily: "Manrope_500Medium",
    fontSize: 11,
    color: colors.textMute,
    marginTop: 2.5,
  },
  playedLabel: {
    fontFamily: "Manrope_700Bold",
    fontSize: 8.5,
    letterSpacing: 1,
    color: colors.textFaint,
    paddingRight: 6,
  },
  nowPlayingWrap: {
    paddingVertical: 8,
  },
  nowPlayingCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(167,140,240,0.22)",
  },
  nowTitle: {
    fontFamily: "Manrope_600SemiBold",
    fontSize: 13.5,
    color: colors.text,
  },
  nowEyebrow: {
    fontFamily: "Manrope_700Bold",
    fontSize: 9.5,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: colors.violetLight,
    marginTop: 5,
  },
  nextUpLabel: {
    paddingHorizontal: 6,
    marginTop: 8,
    marginBottom: 8,
    letterSpacing: 1.7,
  },
  emptyText: {
    fontFamily: "Manrope_500Medium",
    fontSize: 12.5,
    lineHeight: 20,
    color: colors.textFaint,
    textAlign: "center",
    paddingTop: 30,
    paddingHorizontal: 20,
  },
});
