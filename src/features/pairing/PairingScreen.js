import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Body, Eyebrow, ScreenTitle } from "../../components/Typography";
import {
  colors,
  fontFamilies,
  radii,
  spacing,
  type,
} from "../../constants/theme";
import { pairingService } from "../../services/pairingService";

export function PairingScreen() {
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => () => pairingService.cancel(), []);

  const submit = async () => {
    const normalized = code.trim();
    if (!normalized || pending) return;
    setPending(true);
    setError("");
    try {
      await pairingService.pair(
        normalized,
        Platform.OS === "android" ? "Auric Android" : "Auric device",
      );
    } catch (requestError) {
      setError(
        requestError?.code === "PAIRING_CODE_INVALID"
          ? "That code is invalid or has expired."
          : requestError?.code === "RATE_LIMITED"
            ? "Too many attempts. Wait a moment, then try again."
            : "Could not reach your Auric server. Check the connection and try again.",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.center}
      >
        <View style={styles.card}>
          <View style={styles.logoDot} />
          <Eyebrow color={colors.violetLight}>PRIVATE DEVICE</Eyebrow>
          <ScreenTitle style={styles.title}>
            Pair with your Auric server
          </ScreenTitle>
          <Body style={styles.copy}>
            Create a one-time code on your home server, then enter it here. You
            only need to do this once for this device.
          </Body>
          <TextInput
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!pending}
            onChangeText={setCode}
            onSubmitEditing={submit}
            placeholder="AURIC-XXXXX-XXXXX"
            placeholderTextColor={colors.textFaint}
            returnKeyType="done"
            style={styles.input}
            value={code}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable
            accessibilityRole="button"
            disabled={!code.trim() || pending}
            onPress={submit}
            style={({ pressed }) => [
              styles.button,
              (!code.trim() || pending) && styles.buttonDisabled,
              pressed && styles.buttonPressed,
            ]}
          >
            {pending ? (
              <ActivityIndicator color={colors.black} />
            ) : (
              <Text style={styles.buttonLabel}>Pair device</Text>
            )}
          </Pressable>
          <Body style={styles.hint}>On the server: npm run pairing:create</Body>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  center: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.screenH,
  },
  card: {
    gap: 14,
    padding: 24,
    borderRadius: radii.cardLg,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface1,
  },
  logoDot: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: colors.violet,
  },
  title: { marginTop: 2, fontSize: 24, lineHeight: 29 },
  copy: { marginBottom: 6 },
  input: {
    minHeight: 52,
    paddingHorizontal: 16,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface2,
    color: colors.text,
    fontFamily: fontFamilies.mono,
    fontSize: 16,
    letterSpacing: 1,
  },
  error: { ...type.body, color: colors.danger },
  button: {
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.sm,
    backgroundColor: colors.violetLight,
  },
  buttonDisabled: { opacity: 0.45 },
  buttonPressed: { opacity: 0.8 },
  buttonLabel: { ...type.button, color: colors.black },
  hint: { textAlign: "center", color: colors.textFaint, marginTop: 2 },
});

export default PairingScreen;
