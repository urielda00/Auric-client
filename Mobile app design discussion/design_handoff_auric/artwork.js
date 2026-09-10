/**
 * AURIC — deterministic per-track artwork.
 * Same title+artist always yields the same cover. No network, no album images.
 * Framework-agnostic: returns plain numbers + hex strings usable by
 * react-native-svg, expo-linear-gradient, or CSS.
 */

/** FNV-1a, stable across platforms. */
export function hashTrack(title, artist) {
  const s = String(title) + "\u00b7" + String(artist);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
}

/** OKLCH -> sRGB hex. L 0..1, C 0..0.4, H degrees. */
export function oklchToHex(L, C, H) {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  const lin = [
     4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
  const to8 = (v) => {
    const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(c * 255)));
  };
  return "#" + lin.map(to8).map((n) => n.toString(16).padStart(2, "0")).join("");
}

export const PATTERNS = ["hairlines", "dots", "scanlines", "sweep"];

/**
 * @returns {{hue,hue2,blobA,blobB,base,deep,pattern,letter}}
 *   blobA/blobB  radial blob colors (hex)
 *   base/deep    linear base gradient stops (hex)
 *   pattern      one of PATTERNS, drawn white at ~0.11-0.14 alpha, blend "overlay"
 *   letter       big display letter, Space Grotesk 700, white @ 0.16-0.20 alpha
 */
export function trackArt(title, artist) {
  const h = hashTrack(title, artist);
  const hue = h % 360;
  const hue2 = (hue + 55 + ((h >> 7) % 80)) % 360;
  const hue3 = (hue + 200) % 360;
  return {
    hue, hue2,
    blobA: oklchToHex(0.68, 0.155, hue),
    blobB: oklchToHex(0.55, 0.14, hue2),
    base:  oklchToHex(0.30, 0.09, hue3),
    deep:  "#0E0E14",
    pattern: PATTERNS[(h >> 3) % 4],
    letter: String(title).trim().charAt(0).toUpperCase(),
  };
}

/*
Reference CSS the prototype uses (port to <RadialGradient>/<LinearGradient>):

  background:
    radial-gradient(115% 105% at 18% 12%, blobA 0%, transparent 62%),
    radial-gradient(105% 100% at 88% 86%, blobB 0%, transparent 66%),
    linear-gradient(160deg, base, deep);

  hairlines : repeating-linear-gradient(115deg, rgba(255,255,255,.11) 0 2px, transparent 2px 13px)
  dots      : repeating-radial-gradient(circle at 78% 22%, rgba(255,255,255,.13) 0 1.5px, transparent 1.5px 15px)
  scanlines : repeating-linear-gradient(0deg, rgba(0,0,0,.16) 0 3px, transparent 3px 11px)
  sweep     : conic-gradient(from 210deg at 30% 70%, rgba(255,255,255,.14), transparent 32%, rgba(0,0,0,.16) 62%, transparent 90%)
*/
