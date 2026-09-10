import React, { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Defs, RadialGradient, LinearGradient, Stop, Rect, Text as SvgText } from 'react-native-svg';
import { trackArt } from '../utils/artwork';
import { PatternDef } from './TrackArtPattern';

/**
 * Deterministic generated cover art. Auric has no album artwork — every track's visual is
 * derived from its title + artist (or an explicit `visualSeed`), so the same track always
 * renders the same cover, everywhere, with no network round-trip.
 *
 * This is the static (non-animated) presentation used in lists, cards and the mini player.
 * The full player uses `AnimatedTrackArt` for the looping blob/ring/equalizer treatment.
 */
function TrackArtBase({ track, title, artist, size = 46, radius = 14, letter = true, style }) {
  const art = useMemo(() => {
    const t = track ? track.title : title;
    const a = track ? (track.artists || []).join(', ') : artist;
    const seed = track ? track.visualSeed ?? track.id : undefined;
    return trackArt(t || '?', a || '', seed);
  }, [track, title, artist]);

  // Gradient/pattern ids only need to be unique *within* this <Svg>'s own defs scope, so a
  // value derived from the art itself is enough — no randomness needed.
  const uid = `${art.hue}_${art.hue2}_${art.pattern}`;
  const ids = {
    blobA: `a${uid}`,
    blobB: `b${uid}`,
    base: `base${uid}`,
    pattern: `p${uid}`,
  };

  return (
    <View style={[{ width: size, height: size, borderRadius: radius, overflow: 'hidden', backgroundColor: art.deep }, style]}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Defs>
          <LinearGradient id={ids.base} x1="15%" y1="0%" x2="55%" y2="100%">
            <Stop offset="0" stopColor={art.base} />
            <Stop offset="1" stopColor={art.deep} />
          </LinearGradient>
          <RadialGradient id={ids.blobA} cx="18%" cy="12%" rx="80%" ry="75%" gradientUnits="objectBoundingBox">
            <Stop offset="0" stopColor={art.blobA} stopOpacity="1" />
            <Stop offset="0.62" stopColor={art.blobA} stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id={ids.blobB} cx="88%" cy="86%" rx="75%" ry="72%" gradientUnits="objectBoundingBox">
            <Stop offset="0" stopColor={art.blobB} stopOpacity="1" />
            <Stop offset="0.66" stopColor={art.blobB} stopOpacity="0" />
          </RadialGradient>
          <PatternDef id={ids.pattern} pattern={art.pattern} />
        </Defs>
        <Rect x="0" y="0" width="100" height="100" fill={`url(#${ids.base})`} />
        <Rect x="0" y="0" width="100" height="100" fill={`url(#${ids.blobB})`} />
        <Rect x="0" y="0" width="100" height="100" fill={`url(#${ids.blobA})`} />
        <Rect x="0" y="0" width="100" height="100" fill={`url(#${ids.pattern})`} />
        {letter ? (
          <SvgText
            x="97"
            y="112"
            fontFamily="SpaceGrotesk_700Bold"
            fontSize="82"
            fontWeight="700"
            fill="rgba(255,255,255,0.16)"
            textAnchor="end"
          >
            {art.letter}
          </SvgText>
        ) : null}
      </Svg>
    </View>
  );
}

const TrackArt = React.memo(TrackArtBase);
export default TrackArt;
