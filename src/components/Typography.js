import React from 'react';
import { Text } from 'react-native';
import { colors, type } from '../constants/theme';

/** Small typed Text wrappers so screens don't hand-roll font/size/tracking combos. */

export function Eyebrow({ children, color = colors.textFaint, style, ...rest }) {
  return (
    <Text style={[type.eyebrow, { color }, style]} {...rest}>
      {children}
    </Text>
  );
}

export function SectionHeader({ children, color = colors.text, style, ...rest }) {
  return (
    <Text style={[type.sectionHeader, { color }, style]} {...rest}>
      {children}
    </Text>
  );
}

export function ScreenTitle({ children, color = colors.text, style, ...rest }) {
  return (
    <Text style={[type.screenTitle, { color }, style]} {...rest}>
      {children}
    </Text>
  );
}

export function ListTitle({ children, color = colors.text, style, numberOfLines = 1, ...rest }) {
  return (
    <Text style={[type.listTitle, { color }, style]} numberOfLines={numberOfLines} {...rest}>
      {children}
    </Text>
  );
}

export function ListSubtitle({ children, color = colors.textMute, style, numberOfLines = 1, ...rest }) {
  return (
    <Text style={[type.listSubtitle, { color }, style]} numberOfLines={numberOfLines} {...rest}>
      {children}
    </Text>
  );
}

export function Body({ children, color = colors.textMute, style, ...rest }) {
  return (
    <Text style={[type.body, { color }, style]} {...rest}>
      {children}
    </Text>
  );
}
