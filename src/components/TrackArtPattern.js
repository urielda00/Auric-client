import React from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Defs, RadialGradient, Stop, Rect, Pattern, Circle } from 'react-native-svg';

/**
 * The four overlay textures generated artwork can carry (diagonal hairlines, dot field,
 * scanlines, conic sweep). Shared by `TrackArt` (nested inside its own <Svg>) and
 * `AnimatedTrackArt` (used standalone, full-bleed, over the animated blobs).
 */
export function PatternDef({ id, pattern }) {
  switch (pattern) {
    case 'hairlines':
      return (
        <Pattern id={id} patternUnits="userSpaceOnUse" width="13" height="13" patternTransform="rotate(115)">
          <Rect x="0" y="0" width="2" height="13" fill="#fff" opacity="0.11" />
        </Pattern>
      );
    case 'dots':
      return (
        <Pattern id={id} patternUnits="userSpaceOnUse" width="15" height="15">
          <Circle cx="7.5" cy="7.5" r="1.5" fill="#fff" opacity="0.13" />
        </Pattern>
      );
    case 'scanlines':
      return (
        <Pattern id={id} patternUnits="userSpaceOnUse" width="11" height="11">
          <Rect x="0" y="0" width="11" height="3" fill="#000" opacity="0.16" />
        </Pattern>
      );
    case 'sweep':
    default:
      return (
        <RadialGradient id={id} cx="30%" cy="70%" rx="70%" ry="70%" gradientUnits="objectBoundingBox">
          <Stop offset="0" stopColor="#fff" stopOpacity="0.14" />
          <Stop offset="0.32" stopColor="#fff" stopOpacity="0" />
          <Stop offset="0.62" stopColor="#000" stopOpacity="0.16" />
          <Stop offset="0.9" stopColor="#000" stopOpacity="0" />
        </RadialGradient>
      );
  }
}

/** Standalone full-bleed version, for layering over content that isn't already an <Svg>. */
export function PatternOverlay({ pattern }) {
  return (
    <Svg width="100%" height="100%" viewBox="0 0 100 100" style={StyleSheet.absoluteFill}>
      <Defs>
        <PatternDef id="overlay" pattern={pattern} />
      </Defs>
      <Rect x="0" y="0" width="100" height="100" fill="url(#overlay)" />
    </Svg>
  );
}
