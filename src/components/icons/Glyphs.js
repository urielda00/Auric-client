import React from 'react';
import { View, Text } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';

/**
 * Auric's icon set: no icon font or external SVG assets. Glyphs use plain views, with
 * explicit SVG geometry where Android RTL swapping would change a directional shape.
 */

export function SearchGlyph({ size = 13, color = '#C9C9D6', stroke = 1.7 }) {
  const handleW = size * 0.62;
  return (
    <View style={{ width: size, height: size }}>
      <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: stroke, borderColor: color }} />
      <View
        style={{
          position: 'absolute',
          right: -handleW * 0.5,
          bottom: -handleW * 0.45,
          width: handleW,
          height: stroke,
          backgroundColor: color,
          borderRadius: 2,
          transform: [{ rotate: '45deg' }],
        }}
      />
    </View>
  );
}

export function BackChevron({ size = 9, color = '#EDEDF2', stroke = 1.8 }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderLeftWidth: stroke,
        borderBottomWidth: stroke,
        borderColor: color,
        transform: [{ rotate: '45deg' }],
        marginLeft: 3,
      }}
    />
  );
}

export function DownChevron({ size = 9, color = '#EDEDF2', stroke = 1.8 }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderLeftWidth: stroke,
        borderTopWidth: stroke,
        borderColor: color,
        transform: [{ rotate: '45deg' }],
        marginTop: 4,
      }}
    />
  );
}

export function UpChevron({ size = 7, color = '#9A9AB0', stroke = 1.6 }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderLeftWidth: stroke,
        borderTopWidth: stroke,
        borderColor: color,
        transform: [{ rotate: '45deg' }],
        marginTop: 3,
      }}
    />
  );
}

export function StatsGlyph({ color = '#C9C9D6' }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2.5 }}>
      <View style={{ width: 2.5, height: 7, backgroundColor: color, borderRadius: 2 }} />
      <View style={{ width: 2.5, height: 12, backgroundColor: color, borderRadius: 2 }} />
      <View style={{ width: 2.5, height: 9, backgroundColor: color, borderRadius: 2 }} />
    </View>
  );
}

export function PlusGlyph({ size = 13, color = '#C9C9D6', stroke = 1.7 }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ position: 'absolute', width: size, height: stroke, backgroundColor: color, borderRadius: 2 }} />
      <View style={{ position: 'absolute', width: stroke, height: size, backgroundColor: color, borderRadius: 2 }} />
    </View>
  );
}

export function HeartGlyph({ filled, size = 15, filledColor = '#EFA6C6', idleColor = '#5C5C70' }) {
  return <Text style={{ fontSize: size, color: filled ? filledColor : idleColor, lineHeight: size + 2 }}>{filled ? '♥' : '♡'}</Text>;
}

export function PlayTriangle({ size = 12, color = '#EDEDF2' }) {
  return (
    <Svg
      width={size}
      height={size * 1.2}
      viewBox={`0 0 ${size} ${size * 1.2}`}
      style={{ marginLeft: 2 }}
    >
      <Polygon
        points={`0,0 ${size},${size * 0.6} 0,${size * 1.2}`}
        fill={color}
      />
    </Svg>
  );
}

export function PauseBars({ height = 13, width = 3, gap = 3, color = '#0B0B10' }) {
  return (
    <View style={{ flexDirection: 'row', gap }}>
      <View style={{ width, height, backgroundColor: color, borderRadius: 2 }} />
      <View style={{ width, height, backgroundColor: color, borderRadius: 2 }} />
    </View>
  );
}

export function PrevGlyph({ color = '#EDEDF2' }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
      <View style={{ width: 2.5, height: 16, backgroundColor: color, borderRadius: 2 }} />
      <View
        style={{
          width: 0,
          height: 0,
          borderTopWidth: 9,
          borderBottomWidth: 9,
          borderRightWidth: 13,
          borderTopColor: 'transparent',
          borderBottomColor: 'transparent',
          borderRightColor: color,
        }}
      />
    </View>
  );
}

export function NextGlyph({ color = '#EDEDF2' }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
      <View
        style={{
          width: 0,
          height: 0,
          borderTopWidth: 9,
          borderBottomWidth: 9,
          borderLeftWidth: 13,
          borderTopColor: 'transparent',
          borderBottomColor: 'transparent',
          borderLeftColor: color,
        }}
      />
      <View style={{ width: 2.5, height: 16, backgroundColor: color, borderRadius: 2 }} />
    </View>
  );
}

export function QueueGlyph({ color = '#EDEDF2' }) {
  return (
    <View style={{ alignItems: 'center', gap: 3 }}>
      <View style={{ width: 14, height: 1.8, backgroundColor: color, borderRadius: 2 }} />
      <View style={{ width: 14, height: 1.8, backgroundColor: color, borderRadius: 2 }} />
      <View style={{ width: 9, height: 1.8, backgroundColor: color, borderRadius: 2 }} />
    </View>
  );
}

export function GrabHandle({ color = '#55556A', width = 14, count = 3 }) {
  return (
    <View style={{ alignItems: 'center', gap: 3 }}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={{ width, height: 1.6, backgroundColor: color, borderRadius: 2 }} />
      ))}
    </View>
  );
}

export function RemoveGlyph({ color = '#9A9AB0', size = 11, stroke = 1.6 }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ position: 'absolute', width: size, height: stroke, backgroundColor: color, borderRadius: 2, transform: [{ rotate: '45deg' }] }} />
      <View style={{ position: 'absolute', width: size, height: stroke, backgroundColor: color, borderRadius: 2, transform: [{ rotate: '-45deg' }] }} />
    </View>
  );
}

export function HistoryGlyph({ color = '#5AD1E0' }) {
  return (
    <View style={{ width: 15, height: 15, borderRadius: 8, borderWidth: 1.7, borderColor: color, alignItems: 'center' }}>
      <View style={{ position: 'absolute', left: 6, top: 2.5, width: 1.6, height: 5, backgroundColor: color, borderRadius: 2 }} />
    </View>
  );
}
