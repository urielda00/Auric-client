import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import TrackRow from '../../components/TrackRow';
import AmbientGlow from '../../components/AmbientGlow';
import { Eyebrow } from '../../components/Typography';
import { SearchGlyph } from '../../components/icons/Glyphs';
import { useTabBarBottomInset } from '../../hooks/useBottomContentInset';
import { searchService } from '../../services/searchService';
import { usePlayerStore } from '../../stores/usePlayerStore';
import { useQueueStore } from '../../stores/useQueueStore';
import { useLibraryStore } from '../../stores/useLibraryStore';
import { colors } from '../../constants/theme';

const { createLatestSearchRunner } = require('../../services/latestSearch.cjs');
const DEFAULT_RECENTS = ['émile', 'harbour', 'vela', 'marble dust', 'cassette'];
const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

export default function SearchScreen() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [recents, setRecents] = useState(DEFAULT_RECENTS);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [retryVersion, setRetryVersion] = useState(0);
  const play = usePlayerStore((state) => state.play);
  const enqueueNext = useQueueStore((state) => state.enqueueNext);
  const likedIds = useLibraryStore((state) => state.likedIds);
  const toggleLike = useLibraryStore((state) => state.toggleLike);
  const cacheTracks = useLibraryStore((state) => state.cacheTracks);
  const searchRunner = useMemo(() => createLatestSearchRunner((value, options) => searchService.search(value, options), SEARCH_DEBOUNCE_MS), []);

  useEffect(() => {
    searchService.getRecentSearches().then((stored) => {
      if (stored.length) setRecents(stored);
    });
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed || Array.from(trimmed).length < MIN_QUERY_LENGTH) {
      searchRunner.cancel();
      setResults([]);
      setError(null);
      setStatus('idle');
      return;
    }
    searchRunner.run(trimmed, {
      onScheduled: () => {
        setResults([]);
        setStatus('loading');
        setError(null);
      },
      onSuccess: (nextResults) => {
        cacheTracks(nextResults);
        setResults(nextResults);
        setStatus('success');
      },
      onError: (nextError) => {
        setResults([]);
        setError(nextError);
        setStatus('error');
      },
    });
  }, [cacheTracks, query, retryVersion, searchRunner]);

  useEffect(() => () => searchRunner.cancel(), [searchRunner]);

  const handlePlay = useCallback(
    (track) => {
      if (track.hasMedia === false) return;
      play(track.id, { type: 'search', label: 'Search' });
      searchService.addRecentSearch(query).then(setRecents);
    },
    [play, query],
  );

  const isIdle = !query.trim();
  const isTooShort = !isIdle && Array.from(query.trim()).length < MIN_QUERY_LENGTH;
  const noResults = status === 'success' && results.length === 0;
  const bottomInset = useTabBarBottomInset();

  const listHeader = useMemo(
    () =>
      isIdle ? (
        <View style={styles.recentsBlock}>
          <Eyebrow style={{ marginBottom: 12, letterSpacing: 1.5 }}>Recent searches</Eyebrow>
          <View style={styles.chipRow}>
            {recents.map((recent) => (
              <Pressable key={recent} onPress={() => setQuery(recent)} style={styles.chip}>
                <Text style={styles.chipLabel}>{recent}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null,
    [isIdle, recents],
  );

  let emptyContent = null;
  if (status === 'loading') {
    emptyContent = (
      <View style={styles.emptyState}>
        <ActivityIndicator color={colors.violet} />
        <Text style={styles.emptyText}>Searching your library…</Text>
      </View>
    );
  } else if (status === 'error') {
    emptyContent = (
      <View style={styles.emptyState}>
        <Text style={styles.emptyText}>{error?.message || 'Could not reach your Auric server.'}</Text>
        <Pressable onPress={() => setRetryVersion((value) => value + 1)} style={styles.retryButton}>
          <Text style={styles.retryLabel}>Retry</Text>
        </Pressable>
      </View>
    );
  } else if (isTooShort) {
    emptyContent = (
      <View style={styles.emptyState}>
        <Text style={styles.emptyText}>Type at least two characters to search.</Text>
      </View>
    );
  } else if (noResults) {
    emptyContent = (
      <View style={styles.emptyState}>
        <Text style={styles.emptyText}>{`Nothing matched "${query}".`}</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <AmbientGlow />
      <View style={styles.fieldWrap}>
        <View style={styles.field}>
          <SearchGlyph size={13} color="#8B8BA0" />
          <TextInput value={query} onChangeText={setQuery} placeholder="Songs, artists, half-remembered words…" placeholderTextColor="#6E6E82" style={styles.input} autoCorrect={false} />
          {query.length > 0 ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <Text style={styles.clear}>Clear</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <FlatList
        data={isIdle ? [] : results}
        keyExtractor={(track) => track.id}
        style={styles.list}
        contentContainerStyle={[styles.listContent, { paddingBottom: bottomInset }]}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={listHeader}
        renderItem={({ item: track }) => (
          <TrackRow
            track={track}
            liked={likedIds.includes(track.id)}
            showNextPill
            unavailable={track.hasMedia === false}
            onPress={() => handlePlay(track)}
            onPlayNext={() => {
              if (track.hasMedia !== false) enqueueNext(track.id);
            }}
            onToggleLike={() => toggleLike(track.id)}
          />
        )}
        ListEmptyComponent={emptyContent}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  fieldWrap: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 12 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 50,
    borderRadius: 16,
    paddingHorizontal: 14,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  input: {
    flex: 1,
    fontFamily: 'Manrope_500Medium',
    fontSize: 14,
    color: colors.text,
    padding: 0,
  },
  clear: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 12,
    color: '#8B8BA0',
    padding: 6,
  },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 12 },
  recentsBlock: { paddingHorizontal: 6, paddingTop: 6, paddingBottom: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  chipLabel: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 12.5,
    color: '#C9C9D6',
  },
  emptyState: {
    paddingHorizontal: 24,
    paddingTop: 46,
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
