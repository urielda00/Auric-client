import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { colors } from '../constants/theme';

/**
 * Square icon button used throughout: 36dp header actions, 38dp back/queue buttons,
 * 30dp queue row actions. Background/border follow the `surface` token by default.
 */
export default function IconButton({ children, onPress, size = 36, radius = 12, background = colors.surface2, border = colors.hairline, style, hitSlop = 6, ...rest }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={hitSlop}
      style={({ pressed }) => [
        styles.base,
        {
          width: size,
          height: size,
          borderRadius: radius,
          backgroundColor: background,
          borderColor: border,
          opacity: pressed ? 0.7 : 1,
        },
        style,
      ]}
      {...rest}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
});
