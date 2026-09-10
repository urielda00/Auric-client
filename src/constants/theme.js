/**
 * Design tokens ported verbatim from `Mobile app design discussion/design_handoff_auric/README.md`.
 * This is the single source of truth for color, type, spacing and radius — screens and
 * components must consume these tokens instead of inlining values.
 */

export const colors = {
  bg: '#08080B',
  bgSheet: '#101015',
  bgScrim: 'rgba(4,4,7,0.60)',
  surface1: 'rgba(255,255,255,0.045)',
  surface2: 'rgba(255,255,255,0.055)',
  surface3: 'rgba(255,255,255,0.07)',
  hairline: 'rgba(255,255,255,0.08)',
  text: '#EDEDF2',
  textDim: '#9A9AB0',
  textMute: '#7A7A8E',
  textFaint: '#67677A',
  iconIdle: '#55556A',
  violet: '#A78CF0',
  violetLight: '#C4B1FF',
  cyan: '#5AD1E0',
  cyanLight: '#9FE3EC',
  pink: '#EFA6C6',
  pinkLight: '#F5B8D2',
  green: '#8FD9A8',
  danger: '#F09090',
  white: '#EDEDF2',
  black: '#0B0B10',
};

export const gradients = {
  smartShuffle: ['#3A2A72', '#6C3E92', '#245F7E'],
  smartShuffleLocations: [0, 0.46, 1],
  likedCover: ['#EFA6C6', '#8A5CD8', '#3A2A72'],
  likedCoverLocations: [0, 0.6, 1],
  progress: ['#A78CF0', '#5AD1E0'],
  statsHero: ['#2B2350', '#4B2F6E', '#1E4F66'],
  statsHeroLocations: [0, 0.55, 1],
  addTrackButton: ['#7C4FD6', '#4E86C4'],
  logoMark: ['#A78CF0', '#5AD1E0', '#EFA6C6', '#A78CF0'],
};

export const fontFamilies = {
  displaySemiBold: 'SpaceGrotesk_600SemiBold',
  displayBold: 'SpaceGrotesk_700Bold',
  bodyRegular: 'Manrope_400Regular',
  bodyMedium: 'Manrope_500Medium',
  bodySemiBold: 'Manrope_600SemiBold',
  bodyBold: 'Manrope_700Bold',
  bodyExtraBold: 'Manrope_800ExtraBold',
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};

/** Role -> { fontFamily, fontSize, lineHeight, letterSpacing, color? } */
export const type = {
  logo: { fontFamily: fontFamilies.displayBold, fontSize: 17, lineHeight: 17, letterSpacing: 4.08 },
  greeting: { fontFamily: fontFamilies.displaySemiBold, fontSize: 27, lineHeight: 30, letterSpacing: -0.4 },
  screenTitle: { fontFamily: fontFamilies.displaySemiBold, fontSize: 20, lineHeight: 20, letterSpacing: -0.2 },
  playerTitle: { fontFamily: fontFamilies.displaySemiBold, fontSize: 25, lineHeight: 29, letterSpacing: -0.5 },
  statsHeroNumber: { fontFamily: fontFamilies.displayBold, fontSize: 46, lineHeight: 46, letterSpacing: -1.4 },
  sectionHeader: { fontFamily: fontFamilies.bodyBold, fontSize: 15, lineHeight: 15, letterSpacing: -0.15 },
  eyebrow: { fontFamily: fontFamilies.bodyBold, fontSize: 9.5, lineHeight: 9.5, letterSpacing: 1.7, textTransform: 'uppercase' },
  listTitle: { fontFamily: fontFamilies.bodySemiBold, fontSize: 13.5, lineHeight: 17.5 },
  listSubtitle: { fontFamily: fontFamilies.bodyMedium, fontSize: 11.5, lineHeight: 15 },
  body: { fontFamily: fontFamilies.bodyMedium, fontSize: 12.5, lineHeight: 20 },
  button: { fontFamily: fontFamilies.bodyBold, fontSize: 13.5, lineHeight: 13.5 },
  mono: { fontFamily: fontFamilies.mono, fontSize: 11.5, lineHeight: 19 },
};

export const radii = {
  xs: 9,
  sm: 12,
  md: 14,
  row: 15,
  lg: 17,
  card: 20,
  cardLg: 22,
  likedCover: 26,
  sheetTop: 28,
  playerArt: 36,
  full: 999,
};

export const spacing = {
  screenH: 18,
  listPad: 12,
  rowPad: 6,
  cardGap: 12,
  sectionGap: 22,
};

// `boxShadow` is the cross-platform (iOS/Android/Web) replacement for the old
// shadowColor/shadowOffset/shadowOpacity/shadowRadius quartet, which only ever fully
// worked on iOS (shadowColor is the sole one Android also honored) and trips a deprecation
// warning under React Native Web. `elevation` is kept alongside it for Android's native
// drop shadow on architectures/paths where `boxShadow` isn't picked up.
export const shadows = {
  quickPick: {
    boxShadow: '0px 14px 32px rgba(0,0,0,0.5)',
    elevation: 10,
  },
  miniPlayer: {
    boxShadow: '0px -6px 28px rgba(0,0,0,0.5)',
    elevation: 12,
  },
  playerArt: {
    boxShadow: '0px 30px 70px rgba(0,0,0,0.55)',
    elevation: 16,
  },
  playButton: {
    boxShadow: '0px 12px 34px rgba(237,237,242,0.22)',
    elevation: 10,
  },
};

export const timing = {
  sheetUp: 340,
  scrimFade: 200,
  copyFeedback: 1800,
  refresh: 1100,
};

export const theme = { colors, gradients, type, fontFamilies, radii, spacing, shadows, timing };

export default theme;
