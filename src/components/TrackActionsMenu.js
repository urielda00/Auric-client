import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import TrackArt from "./TrackArt";
import { colors, radii, shadows } from "../constants/theme";
import { useQueueStore } from "../stores/useQueueStore";
import { joinArtists, trackDisplayTitle } from "../utils/format";

const {
  canOfferTrackActions,
  performPlayNextAction,
} = require("../services/pressInteraction.cjs");

const TrackActionsContext = createContext({
  openTrackActions: () => false,
  closeTrackActions: () => {},
});

export function TrackActionsProvider({ children }) {
  const [selectedTrack, setSelectedTrack] = useState(null);

  const openTrackActions = useCallback((track) => {
    if (!canOfferTrackActions(track)) return false;
    setSelectedTrack(track);
    return true;
  }, []);
  const closeTrackActions = useCallback(() => setSelectedTrack(null), []);
  const value = useMemo(
    () => ({ openTrackActions, closeTrackActions }),
    [closeTrackActions, openTrackActions],
  );

  const handlePlayNext = useCallback(() => {
    performPlayNextAction({
      track: selectedTrack,
      close: () => setSelectedTrack(null),
      enqueue: (trackId, context) =>
        useQueueStore.getState().enqueueNext(trackId, context),
    });
  }, [selectedTrack]);

  return (
    <TrackActionsContext.Provider value={value}>
      {children}
      <Modal
        animationType="fade"
        transparent
        visible={Boolean(selectedTrack)}
        onRequestClose={closeTrackActions}
        statusBarTranslucent
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close track actions"
          style={styles.backdrop}
          onPress={closeTrackActions}
        >
          <Pressable
            accessibilityViewIsModal
            accessibilityLabel="Track actions"
            style={styles.menu}
            onPress={(event) => event.stopPropagation()}
          >
            {selectedTrack ? (
              <View style={styles.trackHeader}>
                <TrackArt track={selectedTrack} size={48} radius={14} />
                <View style={styles.trackText}>
                  <Text style={styles.title} numberOfLines={1}>
                    {trackDisplayTitle(selectedTrack)}
                  </Text>
                  <Text style={styles.artist} numberOfLines={1}>
                    {joinArtists(selectedTrack.artists)}
                  </Text>
                </View>
              </View>
            ) : null}
            <View style={styles.divider} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Play next"
              onPress={handlePlayNext}
              style={({ pressed }) => [
                styles.action,
                pressed && styles.actionPressed,
              ]}
            >
              <View style={styles.actionIcon}>
                <Text style={styles.actionIconText}>+1</Text>
              </View>
              <Text style={styles.actionLabel}>Play next</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </TrackActionsContext.Provider>
  );
}

export function useTrackActions() {
  return useContext(TrackActionsContext);
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    backgroundColor: "rgba(4,4,7,0.66)",
  },
  menu: {
    width: "100%",
    maxWidth: 340,
    padding: 12,
    borderRadius: 22,
    backgroundColor: colors.bgSheet,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.11)",
    ...shadows.quickPick,
  },
  trackHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 4,
  },
  trackText: { flex: 1, minWidth: 0 },
  title: {
    fontFamily: "Manrope_700Bold",
    fontSize: 14,
    color: colors.text,
  },
  artist: {
    marginTop: 4,
    fontFamily: "Manrope_500Medium",
    fontSize: 11.5,
    color: colors.textMute,
  },
  divider: {
    height: 1,
    marginVertical: 10,
    backgroundColor: colors.hairline,
  },
  action: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 8,
    borderRadius: radii.md,
  },
  actionPressed: { backgroundColor: colors.surface3 },
  actionIcon: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 11,
    backgroundColor: "rgba(167,140,240,0.15)",
    borderWidth: 1,
    borderColor: "rgba(167,140,240,0.24)",
  },
  actionIconText: {
    fontFamily: "Manrope_800ExtraBold",
    fontSize: 11,
    color: colors.violetLight,
  },
  actionLabel: {
    fontFamily: "Manrope_700Bold",
    fontSize: 13.5,
    color: colors.text,
  },
});

export default TrackActionsProvider;
