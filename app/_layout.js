import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Stack } from "expo-router";
import {
  useFonts,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from "@expo-google-fonts/space-grotesk";
import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
  Manrope_800ExtraBold,
} from "@expo-google-fonts/manrope";
import { useAppHydration } from "../src/hooks/useAppHydration";
import { useAuthSession } from "../src/hooks/useAuthSession";
import { usePersistOnBackground } from "../src/hooks/usePersistOnBackground";
import { colors } from "../src/constants/theme";
import { PairingScreen } from "../src/features/pairing/PairingScreen";
import { TrackActionsProvider } from "../src/components/TrackActionsMenu";

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Manrope_800ExtraBold,
  });
  const auth = useAuthSession();
  const hydrated = useAppHydration(auth.hydrated && auth.authenticated);
  usePersistOnBackground();

  if (!fontsLoaded || !auth.hydrated || (auth.authenticated && !hydrated)) {
    return (
      <View style={styles.splash}>
        <View style={styles.logoDot} />
        <Text style={styles.wordmark}>AURIC</Text>
      </View>
    );
  }

  if (!auth.authenticated) {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <PairingScreen />
      </SafeAreaProvider>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <TrackActionsProvider>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.bg },
            }}
          >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="liked"
            options={{ animation: "slide_from_right" }}
          />
          <Stack.Screen
            name="history"
            options={{ animation: "slide_from_right" }}
          />
          <Stack.Screen
            name="stats"
            options={{ animation: "slide_from_right" }}
          />
          <Stack.Screen
            name="add"
            options={{ animation: "slide_from_right" }}
          />
          <Stack.Screen
            name="player"
            options={{ presentation: "modal", animation: "slide_from_bottom" }}
          />
          <Stack.Screen
            name="queue"
            options={{
              presentation: "transparentModal",
              animation: "slide_from_bottom",
            }}
          />
          <Stack.Screen
            name="shuffle"
            options={{
              presentation: "transparentModal",
              animation: "slide_from_bottom",
            }}
          />
          </Stack>
        </TrackActionsProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    backgroundColor: colors.bg,
  },
  logoDot: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: colors.violet,
  },
  wordmark: {
    fontFamily: "Manrope_700Bold",
    fontSize: 13,
    letterSpacing: 4,
    color: colors.textMute,
  },
});
