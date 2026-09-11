import React from "react";
import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import TrackArt from "../../components/TrackArt";
import TrackRow from "../../components/TrackRow";
import { SectionHeader, Eyebrow } from "../../components/Typography";
import { colors, shadows } from "../../constants/theme";
import { trackDisplayTitle, joinArtists } from "../../utils/format";

/**
 * Quick Picks: a horizontal carousel of 4 "reason" cards, then a handful of compact rows.
 * `picks` is `{ cards: [{track, reason, label, color}], rows: [...] }` from
 * recommendationService.getQuickPicks() — this component only renders it.
 */
export default function QuickPicksSection({
  picks,
  status,
  onRetry,
  likedIds,
  onPlay,
  onToggleLike,
}) {
  return (
    <View>
      <View style={styles.headerRow}>
        <SectionHeader>Quick Picks</SectionHeader>
        <Eyebrow color={colors.textFaint} style={{ letterSpacing: 1.5 }}>
          for right now
        </Eyebrow>
      </View>

      {!picks ? (
        <Pressable
          onPress={status === "error" ? onRetry : undefined}
          style={styles.statusWrap}
        >
          <Text style={styles.statusText}>
            {status === "error"
              ? "Quick Picks are unavailable. Tap to retry."
              : "Finding picks from your listening…"}
          </Text>
        </Pressable>
      ) : null}

      {picks ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.carousel}
          decelerationRate="fast"
        >
          {picks.cards.map(({ track, label, color }) => (
            <Pressable
              key={track.id}
              onPress={() => onPlay(track, "Quick Picks")}
              style={styles.card}
            >
              <View style={styles.artWrap}>
                <TrackArt track={track} size={150} radius={22} letter />
                <View style={styles.reasonChip}>
                  <Text style={[styles.reasonLabel, { color }]}>{label}</Text>
                </View>
              </View>
              <Text style={styles.cardTitle} numberOfLines={1}>
                {trackDisplayTitle(track)}
              </Text>
              <Text style={styles.cardArtist} numberOfLines={1}>
                {joinArtists(track.artists)}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {picks ? (
        <View style={styles.rows}>
          {picks.rows.map(({ track, label }) => (
            <TrackRow
              key={track.id}
              track={track}
              subtitle={`${joinArtists(track.artists)} · ${label}`}
              liked={likedIds.includes(track.id)}
              onPress={() => onPlay(track, "Quick Picks")}
              onToggleLike={() => onToggleLike(track.id)}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingBottom: 12,
  },
  carousel: {
    gap: 12,
    paddingHorizontal: 18,
    paddingBottom: 20,
  },
  card: {
    width: 150,
  },
  artWrap: {
    width: 150,
    height: 150,
    borderRadius: 22,
    ...shadows.quickPick,
  },
  reasonChip: {
    position: "absolute",
    left: 9,
    top: 9,
    paddingHorizontal: 8,
    paddingVertical: 4.5,
    borderRadius: 9,
    backgroundColor: "rgba(8,8,11,0.55)",
  },
  reasonLabel: {
    fontFamily: "Manrope_700Bold",
    fontSize: 8.5,
    letterSpacing: 0.9,
    textTransform: "uppercase",
  },
  cardTitle: {
    fontFamily: "Manrope_600SemiBold",
    fontSize: 13.5,
    color: colors.text,
    marginTop: 11,
  },
  cardArtist: {
    fontFamily: "Manrope_500Medium",
    fontSize: 11.5,
    color: colors.textMute,
    marginTop: 3,
  },
  rows: {
    paddingHorizontal: 12,
    paddingBottom: 20,
    gap: 2,
  },
  statusWrap: {
    marginHorizontal: 18,
    marginBottom: 20,
    paddingVertical: 18,
  },
  statusText: {
    fontFamily: "Manrope_500Medium",
    fontSize: 12.5,
    color: colors.textFaint,
  },
});
