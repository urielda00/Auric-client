import React, { useMemo } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import TrackArt from "../../components/TrackArt";
import EqualizerBars from "../../components/EqualizerBars";
import { Eyebrow } from "../../components/Typography";
import DraggableQueueList from "./DraggableQueueList";
import { usePlayerStore } from "../../stores/usePlayerStore";
import { useQueueStore } from "../../stores/useQueueStore";
import { useLibraryStore } from "../../stores/useLibraryStore";
import { colors } from "../../constants/theme";
import { trackDisplayTitle } from "../../utils/format";

export default function QueueScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const currentTrackId = usePlayerStore((s) => s.currentTrackId);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const playQueued = usePlayerStore((s) => s.playQueued);
  const playbackContext = usePlayerStore((s) => s.playbackContext);
  const queueEntries = useQueueStore((s) => s.entries);
  const move = useQueueStore((s) => s.move);
  const removeAt = useQueueStore((s) => s.removeAt);
  const tracksById = useLibraryStore((s) => s.tracksById);

  const current = currentTrackId ? tracksById[currentTrackId] : null;
  const items = useMemo(
    () =>
      queueEntries
        .map((entry) => ({
          id: entry.id,
          trackId: entry.trackId,
          context: entry.context,
          track: tracksById[entry.trackId],
        }))
        .filter((item) => item.track),
    [queueEntries, tracksById],
  );

  const handlePlay = (item, index) => {
    removeAt(index, { persist: false, refill: false });
    playQueued(item.trackId, item.context || playbackContext, item.id);
  };

  return (
    <Pressable style={styles.scrim} onPress={() => router.back()}>
      <Pressable style={styles.sheet} onPress={() => {}}>
        <View style={styles.grabberWrap}>
          <View style={styles.grabber} />
        </View>
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>Queue</Text>
          <Pressable onPress={() => router.back()} hitSlop={8}>
            <Text style={styles.playerBtn}>PLAYER</Text>
          </Pressable>
        </View>

        {current ? (
          <View style={styles.nowPlayingWrap}>
            <LinearGradient
              colors={["rgba(167,140,240,0.16)", "rgba(90,209,224,0.08)"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.nowPlayingCard}
            >
              <TrackArt track={current} size={46} radius={14} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.nowTitle} numberOfLines={1}>
                  {trackDisplayTitle(current)}
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

        <Eyebrow
          style={{
            paddingHorizontal: 18,
            marginBottom: 12,
            letterSpacing: 1.7,
          }}
        >
          Next up · drag to reorder
        </Eyebrow>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: 24 + insets.bottom },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {items.length ? (
            <DraggableQueueList
              items={items}
              onReorder={move}
              onPlay={handlePlay}
              onRemove={(item, index) => removeAt(index)}
            />
          ) : (
            <Text style={styles.emptyText}>
              {
                'Nothing queued. Add tracks with "Play Next" or start a shuffle.'
              }
            </Text>
          )}
        </ScrollView>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(4,4,7,0.6)",
  },
  sheet: {
    height: "78%",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: colors.bgSheet,
    borderTopWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    overflow: "hidden",
  },
  grabberWrap: {
    alignItems: "center",
    paddingTop: 12,
    paddingBottom: 4,
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
    paddingVertical: 10,
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
  nowPlayingWrap: {
    paddingHorizontal: 12,
    paddingBottom: 14,
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
  listContent: {
    paddingHorizontal: 12,
    paddingBottom: 24,
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
