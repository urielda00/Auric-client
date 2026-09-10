import React, { useEffect } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import ScreenHeader from '../../components/ScreenHeader';
import { Eyebrow } from '../../components/Typography';
import TrackArt from '../../components/TrackArt';
import MiniPlayer from '../player/MiniPlayer';
import AmbientGlow from '../../components/AmbientGlow';
import { useAddMusicStore, ADD_STATUS_STEPS } from '../../stores/useAddMusicStore';
import { AI_INSTRUCTIONS } from '../../services/addMusicService';
import { useMeasuredHeight } from '../../hooks/useMeasuredHeight';
import { useMiniPlayerBottomInset } from '../../hooks/useBottomContentInset';
import { colors, gradients } from '../../constants/theme';

export default function AddMusicScreen() {
  const json = useAddMusicStore((s) => s.json);
  const setJson = useAddMusicStore((s) => s.setJson);
  const validate = useAddMusicStore((s) => s.validate);
  const preview = useAddMusicStore((s) => s.preview);
  const error = useAddMusicStore((s) => s.error);
  const errorOpen = useAddMusicStore((s) => s.errorOpen);
  const toggleErrorDetail = useAddMusicStore((s) => s.toggleErrorDetail);
  const copied = useAddMusicStore((s) => s.copied);
  const markCopied = useAddMusicStore((s) => s.markCopied);
  const status = useAddMusicStore((s) => s.status);
  const addTrack = useAddMusicStore((s) => s.addTrack);
  const retry = useAddMusicStore((s) => s.retry);
  const cancelPolling = useAddMusicStore((s) => s.cancelPolling);
  const submitting = useAddMusicStore((s) => s.submitting);
  const failure = useAddMusicStore((s) => s.failure);
  const job = useAddMusicStore((s) => s.job);

  useEffect(() => () => cancelPolling(), [cancelPolling]);

  const handleCopy = async () => {
    await Clipboard.setStringAsync(AI_INSTRUCTIONS);
    markCopied();
  };

  const [miniPlayerHeight, onMiniPlayerLayout] = useMeasuredHeight();
  const bottomInset = useMiniPlayerBottomInset(miniPlayerHeight);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <AmbientGlow />
      <ScreenHeader title="Add Music" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: styles.content.paddingBottom + bottomInset }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.intro}>Ask your assistant for the metadata, paste the JSON, and Auric handles the rest.</Text>

        <Pressable onPress={handleCopy} style={styles.copyBtn}>
          <Text style={styles.copyLabel}>{copied ? 'Instructions copied ✓' : 'Copy AI Instructions'}</Text>
        </Pressable>

        <TextInput
          value={json}
          onChangeText={setJson}
          multiline
          placeholder={'{ "title": "…", "artists": ["…"], "source": "https://…" }'}
          placeholderTextColor="#5C5C6E"
          style={styles.textarea}
          spellCheck={false}
          autoCorrect={false}
          textAlignVertical="top"
        />

        <Pressable onPress={validate} style={styles.validateBtn}>
          <Text style={styles.validateLabel}>Validate & Preview</Text>
        </Pressable>

        {preview ? (
          <View style={styles.previewCard}>
            <View style={styles.previewTop}>
              <TrackArt title={preview.title} artist={preview.artists} size={64} radius={18} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.previewTitle}>{preview.title}</Text>
                <Text style={styles.previewArtists}>{preview.artists}</Text>
                <Text style={styles.previewVersion}>{preview.version.toUpperCase()}</Text>
              </View>
            </View>
            <View style={styles.previewRows}>
              {preview.rows.map((r) => (
                <View key={r.k} style={styles.previewRow}>
                  <Text style={styles.previewKey}>{r.k}</Text>
                  <Text style={styles.previewValue} numberOfLines={1}>
                    {r.v}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {preview ? (
          <Pressable onPress={addTrack} disabled={submitting || job?.status === 'ready'}>
            <LinearGradient colors={gradients.addTrackButton} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[styles.addBtn, (submitting || job?.status === 'ready') && styles.disabled]}>
              <Text style={styles.addLabel}>{submitting ? 'Adding…' : job?.status === 'ready' ? 'Track Added' : 'Add Track'}</Text>
            </LinearGradient>
          </Pressable>
        ) : null}

        {error ? (
          <Pressable onPress={toggleErrorDetail} style={styles.errorCard}>
            <View style={styles.errorHead}>
              <Text style={styles.errorTitle}>{"Couldn't read that JSON"}</Text>
              <Text style={styles.errorToggle}>{errorOpen ? 'Hide details' : 'Show details'}</Text>
            </View>
            {errorOpen ? <Text style={styles.errorDetail}>{error}</Text> : null}
          </Pressable>
        ) : null}

        {status >= 0 ? (
          <View style={styles.statusCard}>
            <Eyebrow style={{ marginBottom: 16, letterSpacing: 1.7 }}>Status</Eyebrow>
            <View style={{ gap: 14 }}>
              {ADD_STATUS_STEPS.map((label, i) => {
                const reached = status >= i;
                const isReady = i === ADD_STATUS_STEPS.length - 1;
                const color = reached ? (isReady ? colors.green : colors.violetLight) : '#3C3C4C';
                return (
                  <View key={label} style={styles.statusRow}>
                    <View style={[styles.statusRing, { borderColor: color }]}>
                      <View style={[styles.statusDot, { backgroundColor: reached ? color : 'transparent' }]} />
                    </View>
                    <Text style={[styles.statusLabel, { color }]}>{label}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}

        {failure ? (
          <View style={styles.importFailureCard}>
            <Text style={styles.errorTitle}>Import failed</Text>
            <Text style={styles.importFailureText}>{failure}</Text>
            {job?.canRetry ? (
              <Pressable onPress={retry} disabled={submitting} style={styles.retryBtn}>
                <Text style={styles.retryLabel}>Retry</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <View style={{ height: 30 }} />
      </ScrollView>
      <View onLayout={onMiniPlayerLayout}>
        <MiniPlayer />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  // paddingBottom starts at 0 on purpose: the trailing 30dp spacer further down provides
  // this screen's own baseline gap, and `bottomInset` is added on top of that.
  content: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 0 },
  intro: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 12.5,
    lineHeight: 20,
    color: colors.textMute,
    paddingBottom: 8,
  },
  copyBtn: {
    height: 46,
    borderRadius: 15,
    marginTop: 8,
    backgroundColor: 'rgba(167,140,240,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(167,140,240,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  copyLabel: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 12.5,
    color: colors.violetLight,
  },
  textarea: {
    height: 160,
    marginTop: 14,
    borderRadius: 18,
    padding: 14,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: colors.hairline,
    color: '#D8D8E4',
    fontFamily: 'ui-monospace',
    fontSize: 11.5,
    lineHeight: 19,
  },
  validateBtn: {
    height: 48,
    marginTop: 12,
    borderRadius: 16,
    backgroundColor: colors.surface3,
    borderWidth: 1,
    borderColor: colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  validateLabel: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 13,
    color: colors.text,
  },
  previewCard: {
    marginTop: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: 'rgba(255,255,255,0.035)',
    overflow: 'hidden',
  },
  previewTop: {
    flexDirection: 'row',
    gap: 14,
    padding: 16,
  },
  previewTitle: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 15,
    color: colors.text,
  },
  previewArtists: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 12,
    color: colors.textDim,
    marginTop: 4,
  },
  previewVersion: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 10,
    letterSpacing: 1.1,
    color: colors.violetLight,
    marginTop: 9,
  },
  previewRows: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
    padding: 16,
    gap: 8,
  },
  previewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 14,
  },
  previewKey: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 11.5,
    color: colors.textFaint,
  },
  previewValue: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 11.5,
    color: '#C9C9D6',
    flexShrink: 1,
    textAlign: 'right',
  },
  addBtn: {
    height: 52,
    marginTop: 12,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addLabel: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 14,
    color: '#fff',
  },
  disabled: {
    opacity: 0.5,
  },
  errorCard: {
    marginTop: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(240,120,120,0.28)',
    backgroundColor: 'rgba(240,120,120,0.08)',
    padding: 15,
  },
  errorHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  errorTitle: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 12.5,
    color: colors.danger,
  },
  errorToggle: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 11,
    color: '#A87A7A',
  },
  errorDetail: {
    fontFamily: 'ui-monospace',
    fontSize: 11,
    lineHeight: 18,
    color: '#C99',
    marginTop: 11,
  },
  importFailureCard: {
    marginTop: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(240,120,120,0.28)',
    backgroundColor: 'rgba(240,120,120,0.08)',
    padding: 15,
  },
  importFailureText: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 11.5,
    lineHeight: 18,
    color: '#C99',
    marginTop: 7,
  },
  retryBtn: {
    alignSelf: 'flex-start',
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(167,140,240,0.35)',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  retryLabel: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 11.5,
    color: colors.violetLight,
  },
  statusCard: {
    marginTop: 20,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: 'rgba(255,255,255,0.035)',
    padding: 18,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  statusRing: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusLabel: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 12.5,
  },
});
