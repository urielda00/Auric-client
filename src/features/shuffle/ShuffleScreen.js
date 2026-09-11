import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Defs, Pattern, Rect } from "react-native-svg";
import { usePlayerStore } from "../../stores/usePlayerStore";
import { colors, gradients } from "../../constants/theme";

export default function ShuffleScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const startSmartShuffle = usePlayerStore((s) => s.startSmartShuffle);
  const startRandomShuffle = usePlayerStore((s) => s.startRandomShuffle);
  const shufflePending = usePlayerStore((s) => s.shufflePending);
  const shuffleError = usePlayerStore((s) => s.shuffleError);

  const runShuffle = async (starter) => {
    if (await starter()) router.replace("/player");
  };

  return (
    <Pressable style={styles.scrim} onPress={() => router.back()}>
      <Pressable
        style={[styles.sheet, { paddingBottom: 26 + insets.bottom }]}
        onPress={() => {}}
      >
        <View style={styles.grabberWrap}>
          <View style={styles.grabber} />
        </View>

        <Pressable
          disabled={Boolean(shufflePending)}
          onPress={() => runShuffle(startSmartShuffle)}
        >
          <LinearGradient
            colors={gradients.smartShuffle}
            locations={gradients.smartShuffleLocations}
            start={{ x: 0.05, y: 0.1 }}
            end={{ x: 0.95, y: 0.9 }}
            style={styles.smartCard}
          >
            <View style={styles.glow} />
            <Text style={styles.smartTitle}>
              {shufflePending === "smart"
                ? "Building your shuffle…"
                : "Smart Shuffle"}
            </Text>
            <Text style={styles.smartBody}>
              {
                "Leans on what you're playing now and what you love, with the occasional song you've forgotten."
              }
            </Text>
            <View style={styles.chipRow}>
              {["ON REPEAT", "LOVED", "FORGOTTEN"].map((label) => (
                <View key={label} style={styles.chip}>
                  <Text style={styles.chipLabel}>{label}</Text>
                </View>
              ))}
            </View>
          </LinearGradient>
        </Pressable>

        <Pressable
          disabled={Boolean(shufflePending)}
          onPress={() => runShuffle(startRandomShuffle)}
          style={styles.randomCard}
        >
          <StripeBackground />
          <Text style={styles.randomTitle}>Random Shuffle</Text>
          <Text style={styles.randomBody}>
            {shufflePending === "random"
              ? "Shuffling the playable library…"
              : "Genuinely random across every playable track. No preferences, no memory."}
          </Text>
        </Pressable>
        {shuffleError ? (
          <Text style={styles.errorText}>{shuffleError}</Text>
        ) : null}
      </Pressable>
    </Pressable>
  );
}

function StripeBackground() {
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
      <Defs>
        <Pattern
          id="stripes"
          patternUnits="userSpaceOnUse"
          width="18"
          height="18"
          patternTransform="rotate(135)"
        >
          <Rect
            x="0"
            y="0"
            width="9"
            height="18"
            fill="rgba(255,255,255,0.045)"
          />
          <Rect
            x="9"
            y="0"
            width="9"
            height="18"
            fill="rgba(255,255,255,0.02)"
          />
        </Pattern>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#stripes)" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(4,4,7,0.6)",
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: colors.bgSheet,
    borderTopWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    padding: 16,
    paddingBottom: 26,
  },
  grabberWrap: {
    alignItems: "center",
    paddingBottom: 16,
  },
  grabber: {
    width: 38,
    height: 4,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  smartCard: {
    borderRadius: 22,
    padding: 20,
    marginBottom: 12,
    overflow: "hidden",
  },
  glow: {
    position: "absolute",
    right: -40,
    top: -56,
    width: 170,
    height: 170,
    borderRadius: 85,
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  smartTitle: {
    fontFamily: "SpaceGrotesk_700Bold",
    fontSize: 17,
    color: "#fff",
  },
  smartBody: {
    fontFamily: "Manrope_500Medium",
    fontSize: 12,
    lineHeight: 18,
    color: "rgba(255,255,255,0.74)",
    marginTop: 8,
  },
  chipRow: {
    flexDirection: "row",
    gap: 7,
    marginTop: 14,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 9,
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  chipLabel: {
    fontFamily: "Manrope_700Bold",
    fontSize: 9,
    letterSpacing: 0.9,
    color: "#fff",
  },
  randomCard: {
    borderRadius: 22,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.hairline,
    overflow: "hidden",
  },
  randomTitle: {
    fontFamily: "SpaceGrotesk_700Bold",
    fontSize: 17,
    color: colors.text,
  },
  randomBody: {
    fontFamily: "Manrope_500Medium",
    fontSize: 12,
    lineHeight: 18,
    color: colors.textMute,
    marginTop: 8,
  },
  errorText: {
    fontFamily: "Manrope_500Medium",
    fontSize: 12,
    lineHeight: 18,
    color: "#EFA6C6",
    marginTop: 12,
    paddingHorizontal: 4,
  },
});
