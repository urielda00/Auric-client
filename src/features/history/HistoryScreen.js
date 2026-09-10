import React, { useMemo } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ScreenHeader from '../../components/ScreenHeader';
import TrackRow from '../../components/TrackRow';
import { Eyebrow } from '../../components/Typography';
import MiniPlayer from '../player/MiniPlayer';
import AmbientGlow from '../../components/AmbientGlow';
import { historyService } from '../../services/historyService';
import { useLibraryStore } from '../../stores/useLibraryStore';
import { useQueueStore } from '../../stores/useQueueStore';
import { usePlayerStore } from '../../stores/usePlayerStore';
import { useMeasuredHeight } from '../../hooks/useMeasuredHeight';
import { useMiniPlayerBottomInset } from '../../hooks/useBottomContentInset';
import { colors } from '../../constants/theme';

export default function HistoryScreen() {
  const history = useLibraryStore((s) => s.history);
  const tracksById = useLibraryStore((s) => s.tracksById);
  const likedIds = useLibraryStore((s) => s.likedIds);
  const toggleLike = useLibraryStore((s) => s.toggleLike);
  const play = usePlayerStore((s) => s.play);
  const enqueueNext = useQueueStore((s) => s.enqueueNext);

  const groups = useMemo(() => {
    return historyService
      .groupEntries(history)
      .map((g) => ({
        label: g.label,
        items: g.items.map((it) => ({ ...it, track: tracksById[it.trackId] })).filter((it) => it.track),
      }))
      .filter((g) => g.items.length);
  }, [history, tracksById]);

  const [miniPlayerHeight, onMiniPlayerLayout] = useMeasuredHeight();
  const bottomInset = useMiniPlayerBottomInset(miniPlayerHeight);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <AmbientGlow />
      <ScreenHeader title="History" />
      <FlatList
        style={styles.list}
        data={groups}
        keyExtractor={(g) => g.label}
        contentContainerStyle={[styles.listContent, { paddingBottom: styles.listContent.paddingBottom + bottomInset }]}
        renderItem={({ item: group }) => (
          <View style={styles.group}>
            <Eyebrow style={{ paddingHorizontal: 6, marginBottom: 12, letterSpacing: 1.7 }}>{group.label}</Eyebrow>
            <View style={{ gap: 2 }}>
              {group.items.map((entry) => (
                <TrackRow
                  key={entry.entryId}
                  track={entry.track}
                  artSize={44}
                  artRadius={13}
                  subtitle={`${entry.when} · ${entry.track.artists.join(', ')}`}
                  liked={likedIds.includes(entry.trackId)}
                  showNextPill
                  onPress={() => play(entry.trackId, { type: 'history', label: 'History' })}
                  onPlayNext={() => enqueueNext(entry.trackId)}
                  onToggleLike={() => toggleLike(entry.trackId)}
                />
              ))}
            </View>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>Nothing played yet.{'\n'}Your listening history will show up here.</Text>
          </View>
        }
      />
      <View onLayout={onMiniPlayerLayout}>
        <MiniPlayer />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 12,
    paddingTop: 20,
    paddingBottom: 24,
  },
  group: {
    marginBottom: 22,
  },
  emptyState: {
    paddingHorizontal: 24,
    paddingTop: 40,
  },
  emptyText: {
    textAlign: 'center',
    fontFamily: 'Manrope_500Medium',
    fontSize: 13,
    lineHeight: 21,
    color: colors.textFaint,
  },
});
