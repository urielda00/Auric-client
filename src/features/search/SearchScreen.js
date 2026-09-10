import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, FlatList, StyleSheet } from 'react-native';
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

const DEFAULT_RECENTS = ['émile', 'harbour', 'vela', 'marble dust', 'cassette'];

export default function SearchScreen() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [recents, setRecents] = useState(DEFAULT_RECENTS);
  const play = usePlayerStore((s) => s.play);
  const enqueueNext = useQueueStore((s) => s.enqueueNext);
  const likedIds = useLibraryStore((s) => s.likedIds);
  const toggleLike = useLibraryStore((s) => s.toggleLike);

  useEffect(() => {
    searchService.getRecentSearches().then((stored) => {
      if (stored.length) setRecents(stored);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!query.trim()) {
      setResults([]);
      return undefined;
    }
    searchService.search(query).then((r) => {
      if (!cancelled) setResults(r);
    });
    return () => {
      cancelled = true;
    };
  }, [query]);

  const handlePlay = useCallback(
    (track) => {
      play(track.id, { type: 'search', label: 'Search' });
      searchService.addRecentSearch(query).then(setRecents);
    },
    [play, query]
  );

  const isIdle = !query.trim();
  const noResults = !isIdle && results.length === 0;
  const bottomInset = useTabBarBottomInset();

  const listHeader = useMemo(
    () =>
      isIdle ? (
        <View style={styles.recentsBlock}>
          <Eyebrow style={{ marginBottom: 12, letterSpacing: 1.5 }}>Recent searches</Eyebrow>
          <View style={styles.chipRow}>
            {recents.map((r) => (
              <Pressable key={r} onPress={() => setQuery(r)} style={styles.chip}>
                <Text style={styles.chipLabel}>{r}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null,
    [isIdle, recents]
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <AmbientGlow />
      <View style={styles.fieldWrap}>
        <View style={styles.field}>
          <SearchGlyph size={13} color="#8B8BA0" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Songs, artists, half-remembered words…"
            placeholderTextColor="#6E6E82"
            style={styles.input}
            autoCorrect={false}
          />
          {query.length > 0 ? (
            <Pressable onPress={() => setQuery('')} hitSlop={8}>
              <Text style={styles.clear}>Clear</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <FlatList
        data={isIdle ? [] : results}
        keyExtractor={(t) => t.id}
        style={styles.list}
        contentContainerStyle={[styles.listContent, { paddingBottom: styles.listContent.paddingBottom + bottomInset }]}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={listHeader}
        renderItem={({ item: track }) => (
          <TrackRow
            track={track}
            liked={likedIds.includes(track.id)}
            showNextPill
            onPress={() => handlePlay(track)}
            onPlayNext={() => enqueueNext(track.id)}
            onToggleLike={() => toggleLike(track.id)}
          />
        )}
        ListEmptyComponent={
          noResults ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>
                {`Nothing matched "${query}".`}
                {'\n'}
                Try fewer letters — search is fuzzy.
              </Text>
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  fieldWrap: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 12,
  },
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
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 12,
    paddingBottom: 20,
  },
  recentsBlock: {
    paddingHorizontal: 6,
    paddingTop: 6,
    paddingBottom: 8,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
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
  },
  emptyText: {
    textAlign: 'center',
    fontFamily: 'Manrope_500Medium',
    fontSize: 13,
    lineHeight: 21,
    color: colors.textFaint,
  },
});
