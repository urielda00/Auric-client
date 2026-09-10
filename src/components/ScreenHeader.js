import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import IconButton from './IconButton';
import { BackChevron } from './icons/Glyphs';
import { ScreenTitle } from './Typography';
import { colors } from '../constants/theme';

/** Back arrow + optional title, used by every pushed screen (Liked, History, Stats, Add). */
export default function ScreenHeader({ title, style }) {
  const router = useRouter();
  return (
    <View style={[styles.row, style]}>
      <IconButton size={38} radius={13} background={colors.surface3} border="transparent" onPress={() => router.back()} accessibilityLabel="Back">
        <BackChevron />
      </IconButton>
      {title ? <ScreenTitle>{title}</ScreenTitle> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 12,
    paddingTop: 14,
  },
});
