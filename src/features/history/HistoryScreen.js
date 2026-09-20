import React, { useEffect, useMemo } from 'react';
import { ActivityIndicator, View, Text, Pressable, FlatList, StyleSheet } from 'react-native';
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
  const historyStatus = useLibraryStore((s) => s.historyStatus);
  const historyError = useLibraryStore((s) => s.historyError);
  const historyNextCursor = useLibraryStore((s) => s.historyNextCursor);
  const refreshHistory = useLibraryStore((s) => s.refreshHistory);
  const loadMoreHistory = useLibraryStore((s) => s.loadMoreHistory);
  const playTrackFromContext = usePlayerStore((s) => s.playTrackFromContext);
  const enqueueNext = useQueueStore((s) => s.enqueueNext);

  useEffect(() => {
    refreshHistory();
  }, [refreshHistory]);

  const groups = useMemo(() => {
    return historyService
      .groupEntries(history)
      .map((g) => ({
        label: g.label,
        items: g.items.map((it) => ({ ...it, track: tracksById[it.trackId] })).filter((it) => it.track),
      }))
      .filter((g) => g.items.length);
  }, [history, tracksById]);
  const historyItems = useMemo(
    () => groups.flatMap((group) => group.items),
    [groups],
  );
  const historyTracks = useMemo(() => historyItems.map((item) => item.track), [historyItems]);

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
        refreshing={historyStatus === 'loading'}
        onRefresh={refreshHistory}
        onEndReached={() => {
          if (historyNextCursor) loadMoreHistory();
        }}
        onEndReachedThreshold={0.4}
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
                  unavailable={entry.track.hasMedia === false}
                  showNextPill
                  onPress={() => playTrackFromContext(
                    entry.trackId,
                    historyTracks,
                    { type: 'history', label: 'History' },
                    historyItems.findIndex((item) => item.entryId === entry.entryId),
                  )}
                  onPlayNext={() => enqueueNext(entry.trackId)}
                  onToggleLike={() => toggleLike(entry.trackId)}
                />
              ))}
            </View>
          </View>
        )}
        ListFooterComponent={historyStatus === 'loadingMore' ? <ActivityIndicator color={colors.violet} /> : null}
        ListEmptyComponent={historyStatus === 'loading' ? (
          <View style={styles.emptyState}>
            <ActivityIndicator color={colors.violet} />
          </View>
        ) : historyStatus === 'error' ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>{historyError?.message || 'Could not load listening history.'}</Text>
            <Pressable onPress={refreshHistory} style={styles.retryButton}>
              <Text style={styles.retryLabel}>Retry</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>Nothing played yet.{'\n'}Your listening history will show up here.</Text>
          </View>
        )}
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
    alignItems: 'center',
    gap: 12,
  },
  emptyText: {
    textAlign: 'center',
    fontFamily: 'Manrope_500Medium',
    fontSize: 13,
    lineHeight: 21,
    color: colors.textFaint,
  },
  retryButton: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: colors.surface3,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  retryLabel: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 12,
    color: colors.text,
  },
});
