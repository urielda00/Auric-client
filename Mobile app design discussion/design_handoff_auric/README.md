# Handoff: AURIC — private music streaming app (Android, React Native + Expo)

## Overview
AURIC is a single-user music player for a private home server holding ~1,684 tracks.
Dark-mode only, one-handed, premium and fast. It has **no album artwork at all** — every
track's visual is generated deterministically from its title+artist. That generated-art
system is the product's visual identity and must be ported exactly (see `artwork.js`).

Primary flow: open app → good choices immediately → tap a song → playback continues
intelligently → queue is easy to control.

## About the Design Files
The files in `design/` are **design references created in HTML** — an interactive
prototype showing intended look and behavior. They are **not production code to copy**.
The task is to **recreate this design in React Native / Expo** using the stack below,
matching the visual spec in this README pixel-for-pixel (adjusted for device density).

Open `design/Auric Player.dc.html` in a browser to click through the real prototype.

## Fidelity
**High-fidelity.** Colors, typography, spacing, radii and interactions are final.
Recreate pixel-perfectly. Values in this README are in CSS px at a 424×944 logical
viewport (Galaxy S26+ class device) — they map 1:1 to React Native `dp`.

---

## Target stack (given by the owner)
- React Native + **Expo**, **JavaScript** (no TypeScript)
- **Expo Router** for navigation
- **expo-audio** for playback
- Background playback, lock-screen media controls, Bluetooth media controls
- **AsyncStorage** for local state persistence (queue, playback position, likes, history)
- **SecureStore** for server token / auth
- **fetch** or Axios for server calls
- HTTPS streaming of **M4A**
- **Zustand** (preferred) or React Context for player + queue state
- **Reanimated** for gestures and animations (drag-reorder, sheets, swipe actions)

Suggested extra deps: `expo-linear-gradient`, `react-native-svg` (radial gradients),
`@shopify/flash-list` (long lists), `react-native-gesture-handler`,
`react-native-reanimated`, `expo-font`.

### Route map (Expo Router)
```
app/
  _layout.js            root: fonts, Zustand hydrate, <PlayerHost/> (mini player + tab bar)
  (tabs)/_layout.js     bottom tabs: Home, Search  (mini player rendered ABOVE the tab bar)
  (tabs)/index.js       Home
  (tabs)/search.js      Search
  liked.js              Liked Songs        (pushed, has back arrow)
  history.js            History
  stats.js              Stats
  add.js                Add Music
  player.js             Full Player        (presentation: 'modal' / full-screen, slide up)
  queue.js              Queue              (presentation: 'transparentModal', sheet over player)
  shuffle.js            Shuffle chooser    (presentation: 'transparentModal', bottom sheet)
```
The queue sheet must render **on top of the full player**, not replace it.

---

## Design tokens

### Color
| Token | Value | Use |
|---|---|---|
| `bg` | `#08080B` | app background |
| `bgSheet` | `#101015` | bottom sheets |
| `bgScrim` | `rgba(4,4,7,0.60)` | modal scrim |
| `surface1` | `rgba(255,255,255,0.045)` | stat tiles, cards |
| `surface2` | `rgba(255,255,255,0.055)` | icon buttons |
| `surface3` | `rgba(255,255,255,0.07)` | secondary buttons |
| `hairline` | `rgba(255,255,255,0.08)` | borders |
| `text` | `#EDEDF2` | primary text |
| `textDim` | `#9A9AB0` | secondary text |
| `textMute` | `#7A7A8E` | tertiary / subtitles |
| `textFaint` | `#67677A` | section labels |
| `iconIdle` | `#55556A` | inactive nav / glyphs |
| `violet` | `#A78CF0` / light `#C4B1FF` | primary accent |
| `cyan` | `#5AD1E0` / light `#9FE3EC` | secondary accent |
| `pink` | `#EFA6C6` / light `#F5B8D2` | like / Liked Songs |
| `green` | `#8FD9A8` | "Ready" status |
| `danger` | `#F09090` | errors |

Gradients:
- Smart Shuffle card: `linear-gradient(118deg, #3A2A72 0%, #6C3E92 46%, #245F7E 100%)`
- Liked Songs cover: `linear-gradient(140deg, #EFA6C6, #8A5CD8 60%, #3A2A72)`
- Progress fill: `linear-gradient(90deg, #A78CF0, #5AD1E0)`
- Stats hero: `linear-gradient(140deg, #2B2350, #4B2F6E 55%, #1E4F66)`
- Add Track button: `linear-gradient(110deg, #7C4FD6, #4E86C4)`
- Logo mark: `conic-gradient(from 140deg, #A78CF0, #5AD1E0, #EFA6C6, #A78CF0)`

### Typography
Two Google fonts, loaded with `expo-font`:
- **Space Grotesk** (600/700) — display: screen titles, big numbers, logo, artwork letter.
- **Manrope** (400/500/600/700/800) — everything else.

| Role | Font | Size / line-height / weight / tracking |
|---|---|---|
| Logo "AURIC" | Space Grotesk 700 | 17 / 1 / letter-spacing 0.24em |
| Greeting | Space Grotesk 600 | 27 / 1.12 / -0.015em |
| Screen title | Space Grotesk 600 | 20 / 1 / -0.01em |
| Player title | Space Grotesk 600 | 25 / 1.15 / -0.02em |
| Stats hero number | Space Grotesk 700 | 46 / 1 / -0.03em |
| Section header | Manrope 700 | 15 / 1 / -0.01em |
| Eyebrow label | Manrope 700 | 9.5 / 1 / 0.18em UPPERCASE |
| List title | Manrope 600 | 13.5 / 1.3 |
| List subtitle | Manrope 500 | 11.5 / 1.3 |
| Body | Manrope 500 | 12.5 / 1.6 |
| Button | Manrope 700 | 13–14 / 1 |
| Mono (JSON/errors) | system mono | 11.5 / 1.65 |

Minimum tap target is 34–46 dp; all icon buttons are ≥34 dp squares.

### Radius
`9` (small chips) · `10–13` (icon buttons, list thumbs) · `14–17` (rows, buttons) ·
`18–22` (cards, mini player, sheets' inner cards) · `26` (Liked cover) · `28` (sheet top
corners) · `36` (full-player artwork) · `50%` (transport buttons).

### Spacing
Screen horizontal padding **18**. List container padding **12** with rows padded **6–7**.
Card grid gap **12**. Section vertical rhythm **20–26**.

### Shadow / blur
- Quick Pick card: `0 14px 32px rgba(0,0,0,.5)`
- Mini player: `0 -6px 28px rgba(0,0,0,.5)` + `backdropFilter blur(24px)` → use
  `expo-blur` `<BlurView intensity={40} tint="dark">`
- Full-player artwork: `0 30px 70px rgba(0,0,0,.55)`
- Play button: `0 12px 34px rgba(237,237,242,.22)`
- Tab bar: dark translucent `rgba(8,8,11,.7)` + blur(20)

---

## The generated-artwork system (CRITICAL)
No album covers, ever. Each track gets a stable abstract cover derived from a FNV-1a hash
of `"${title}·${artist}"`. Same song → same art, forever, on every device, with no
server round-trip. Port `artwork.js` (included, framework-agnostic) verbatim.

It yields, per track:
- `hue`, `hue2` — two OKLCH hues 55–135° apart
- two blob colors `oklch(0.68 0.155 h1)` and `oklch(0.55 0.14 h2)`, base `oklch(0.30 0.09 h3)`
- `pattern` — one of 4 overlay textures (diagonal hairlines / dot field / horizontal
  scanlines / conic sweep), blended `overlay`
- `letter` — first character of the title, uppercase

**React Native implementation:** RN has no CSS gradients. Use `react-native-svg`:
two `<RadialGradient>` ellipses over a `<LinearGradient>` base, plus the pattern as an
SVG `<Pattern>` at ~11–14% white opacity. Wrap it in a memoized `<TrackArt track size />`
component and cache by track id. OKLCH: RN doesn't parse it — `artwork.js` exports
`oklchToHex()` so you can precompute hex.

Sizes in use: **150** (Quick Pick card, radius 22), **46/44/42** (list & mini-player
thumbs, radius 13–14), **64** (Add Music preview, radius 18), **full width − 60**
(full player, radius 36).

**Full-player art is animated** (Reanimated, infinite, respects reduce-motion):
- Blob A: 70% square, top-left −6%/−8%, `translate(0,0)→(16%,-12%) scale 1→1.2`, 13 s ease-in-out alternate
- Blob B: 64% square, bottom-right −8%/−6%, `scale 1.15→0.9, translate(-18%,14%)`, 17 s alternate
- Ring: inset 14%, 1 px `rgba(255,255,255,.16)` circle with a 7 px white dot at 12 o'clock, rotating 360° / 44 s linear
- Letter: Space Grotesk 700, 130 px, `rgba(255,255,255,.2)`, centered
- 4-bar equalizer bottom-left (3 px bars, 22 px tall, scaleY .3→1, 1.1 s, staggered
  0/.35/.7/.15 s); opacity 1 when playing, 0.25 when paused

---

## Screens

### 1. Home  `(tabs)/index.js`
**Purpose:** open the app and immediately have something good to play.

Layout, top to bottom:
1. **Pull-to-refresh** zone. Drag translates content down at 0.55× finger delta, max 84.
   Label (Manrope 700 / 9.5 / 0.2em uppercase, `#8B8BA0`): "Pull to refresh" →
   "Release to refresh" past 56 → "Refreshing" while working (~1.1 s). On success,
   Quick Picks reshuffle and the greeting temporarily reads "Finding something new…".
2. **Header** (padding 16/18): logo dot 26×26 radius 9 conic gradient with
   `0 0 22px rgba(167,140,240,.45)` glow + wordmark "AURIC". Right: three 36×36 radius-12
   `surface2` buttons — search, stats (3 bars), add (+). These are the only entry points
   to Stats and Add Music.
3. **Greeting** "Good evening, Uriel." (owner's name, hardcoded — single-user app) + line "1,684 songs · 41h this year" (Manrope 500 / 12.5, `textMute`).
4. **Quick Picks** header row: "Quick Picks" (Manrope 700 / 15) + right eyebrow "FOR RIGHT NOW".
5. **Horizontal carousel**, 4 cards, 150×150 art, gap 12, first/last inset 18.
   Each card has a **reason chip** top-left (padding 4.5/8, radius 9,
   `rgba(8,8,11,.55)` + blur 10, Manrope 700 / 8.5 / 0.12em uppercase) colored by kind:
   "On repeat" `#C4B1FF` · "You love this" `#F5B8D2` · "Not since May" `#9FE3EC`.
   This chip is how the balance between *current rotation / familiar favorites / long-forgotten*
   is communicated — keep the mix roughly 2 : 2 : 1 and never show a bare unlabeled card.
   Title Manrope 600/13.5 (10 top margin), artist Manrope 500/11.5 `textMute`.
6. **Four compact rows** below the carousel: 46×46 art, title, "Artist · Reason" subtitle,
   trailing 36×36 heart toggle (`♡` `#5C5C70` → `♥` `#EFA6C6`).
7. **Smart Shuffle banner**: full-width radius 22, padding 20, the 118° gradient, a
   190 px white radial glow bleeding off the top-right, a 46×46 radius-16 translucent
   play tile, title Space Grotesk 700 / 17, subtitle "Play something I'll probably enjoy".
   Tapping opens the shuffle chooser sheet.
8. **Two tiles, 1fr 1fr, gap 12**: Liked Songs (pink-tinted) and History (cyan-tinted),
   radius 20, padding 16, 38×38 icon tile, title Manrope 700 / 14.5, sub Manrope 500 / 11.

### 2. Mini Player (persistent)
Sits directly above the tab bar on **every** screen whenever a track is loaded — playing
or paused, including the Add Music screen. Container: horizontal margin 10, radius 20,
`rgba(22,22,29,.82)` + blur 24, 1 px hairline, top shadow.
Row: 44×44 art · title (Manrope 600/13) + artist (500/11) · 34 heart · 40 dp white circle
play/pause (pause = two 3×13 bars, play = 11 px triangle, both `#0B0B10`).
Bottom edge: 2.5 px track `rgba(255,255,255,.08)` with the violet→cyan progress fill.
Tapping the left region opens the Full Player.

**Persistence:** on cold start, rehydrate track + position + queue + source from
AsyncStorage and show the mini player immediately, paused, at the saved position.
Write position at most every 5 s and on every pause/skip/background transition.

### 3. Full Player  `player.js`
Slide-up, 340 ms `cubic-bezier(.22,1,.36,1)`. Background `#08080B` plus the current
track's art blurred 70 px at 50% opacity bleeding from the top.
- Top bar: 38 dp back chevron (down) · centered eyebrow showing **playback source**
  ("Smart Shuffle", "Liked Songs · Shuffle", "Search", "Quick Picks", "History") · 38 dp
  queue button (three stacked bars, last one short).
- Artwork: square, horizontal padding 30, radius 36, animated as described above.
- Title / artist block (padding 22/26) with a 46×46 radius-16 like button on the right;
  when liked, its background becomes `rgba(239,166,198,.14)` with a matching border.
- Progress: 4 px track, 12 px white thumb, tappable-to-seek 22 px hit strip; times below
  (Manrope 500/11, `textMute`), elapsed left / total right.
- Transport: Prev · **76 dp white circle** play/pause · Next, gap 34, bottom padding 34.
No lyrics. Nothing else.

### 4. Queue  `queue.js`
Bottom sheet at **78% height** over the full player (scrim `rgba(4,4,7,.6)`, tap to
dismiss back to the player; the player must stay mounted behind it).
Radius 28 top, `#101015`, 38×4 grabber, header "Queue" + a "PLAYER" text button.
- **Now-playing card**: radius 18, `linear-gradient(120deg, rgba(167,140,240,.16), rgba(90,209,224,.08))`
  with a violet border, "NOW PLAYING" eyebrow in `#C4B1FF`, and a live 3-bar equalizer.
- Eyebrow "NEXT UP · DRAG TO REORDER".
- Rows: 26 dp grab handle (3 bars) · 42 art · title/artist · **move-up** button ·
  **remove** (×). Drag-reorder with Reanimated + gesture-handler; the dragged row goes to
  `rgba(167,140,240,.14)` at 60% opacity. The visible up/remove buttons exist so nothing
  depends on discovering the drag gesture.
- Tapping a row plays it and removes it from the queue. The currently playing track must
  never appear in Next up.

### 5. Search  `(tabs)/search.js`
Field: 50 dp tall, radius 16, `surface2`, magnifier glyph, placeholder
"Songs, artists, half-remembered words…", trailing "Clear" when non-empty.
Results **while typing**, no submit, no artist or album pages.
Matching: NFD-normalize + strip diacritics + lowercase + drop punctuation, then score each
term — full substring hit = 10, prefix hit on any word (allowing one dropped trailing
character) = 4 — sum, keep > 0, sort desc. An alias map handles alternative spellings
(`harbor→harbour`, `emile→émile`, `nite→night`, …); keep it server-side-extendable.
Row: 46 art · title/artist · **NEXT** pill (30 dp, radius 10 — "play next") · heart.
Tapping the row plays now. Empty state before typing shows recent-search chips;
no-results copy: "Nothing matched “x”. Try fewer letters — search is fuzzy."

### 6. Liked Songs  `liked.js`
Back arrow, then a 96×96 radius-26 gradient cover with a ♥ glyph beside the title
"Liked Songs" (Space Grotesk 600/24) and "N songs · plays as its own set".
Action row: full-width white **Shuffle** button (52 dp, radius 17, `#EDEDF2` on
`#0B0B10` text) + a 52 dp secondary play square.
List is **newest-liked first**; the top row's title is tinted `#F5B8D2`.
**Playback rule:** starting here sets the queue to Liked Songs only; when it ends,
playback ends — no auto-continuation into the wider library. Shuffle shuffles only this set.

### 7. History  `history.js`
Groups: **Today / Yesterday / Earlier this week**, each with an eyebrow header.
Row: 44 art · title · "time · artist" subtitle · NEXT pill · heart. Nothing more.

### 8. Shuffle chooser  `shuffle.js`
Bottom sheet opened from the Home banner. Two visually distinct cards:
- **Smart Shuffle** — the purple/teal gradient card, body copy "Leans on what you're
  playing now and what you love, with the occasional song you've forgotten." plus three
  translucent chips: ON REPEAT · LOVED · FORGOTTEN. Never explain the algorithm further.
- **Random Shuffle** — flat, no color: a 135° 9 px repeating diagonal stripe texture on a
  hairline-bordered card, "Genuinely random across all 1,684 tracks. No preferences, no memory."

Weighting for Smart Shuffle (server or client, tune freely): play count in the last 14
days ×3, liked ×2, high average completion ratio ×2, not-played-in-90-days ×1.5 injected
at ~20% of picks, recent skip ×0.6 (floor 0.15 so nothing disappears), and a no-repeat
window of the last 25 tracks.

### 9. Add Music  `add.js`
Deliberately quiet — reached only from the Home + button, styled like the rest of the app.
Back arrow + "Add Music", one line of explanation, then:
1. **Copy AI Instructions** — 46 dp violet-tinted button; label swaps to
   "Instructions copied ✓" for 1.8 s.
2. **JSON textarea** — 160 dp, radius 18, monospace 11.5/1.65, placeholder
   `{ "title": "…", "artists": ["…"], "source": "https://…" }`.
3. **Validate & Preview** — neutral 48 dp button.
4. **Preview card** — 64 dp generated art, title, artists, version eyebrow in `#C4B1FF`,
   then a key/value block: Album · Year · Source (missing values render "—").
5. **Add Track** — 52 dp gradient button.
6. **Status list** — Queued → Downloading → Processing → **Ready** (green), each a 20 dp
   ring that fills when reached; failures show a red card reading "Couldn't read that
   JSON" with a **Show details** disclosure — raw error text stays collapsed by default.

### 10. Stats  `stats.js`
Fun, not a dashboard. Hero gradient card: "LISTENING TIME" eyebrow, "41h 12m" at 46 px,
and a human line ("≈ 6 minutes of every hour awake"). Then a 2×2 tile grid (tracks in
library, liked tracks, different songs played, rediscovered this month), a **Most played**
top-5 with rank, play count and a violet→cyan bar scaled to the #1 track, and a
**Rediscovered lately** row of cyan chips. That's the whole screen.

---

## Interactions & behavior
- **Background playback + lock screen + Bluetooth**: configure `expo-audio` with
  `staysActiveInBackground`, `shouldPlayInBackground`, and a media-session/notification
  with title, artist, and the generated art rendered to a PNG (`react-native-view-shot`
  or a small server-side render) so lock screen and car head units show the same visual.
  Handle play/pause/next/previous/seek from remote commands.
- **Gestures** (all with a visible fallback): swipe a list row right → Like, left → Play
  Next, long-press drag in the queue → reorder. Never gesture-only.
- **Loading/buffering**: never a spinner over the whole screen — the mini-player progress
  bar shows an indeterminate shimmer while buffering; rows stay tappable.
- **Persistence** (AsyncStorage): `current` {trackId, positionMs, source}, `queue` [ids],
  `liked` [ids, newest first], `history` [{id, playedAt}], `recentSearches`.
  Auth token → **SecureStore**.
- **Animation timings**: sheet up 300–340 ms `cubic-bezier(.22,1,.36,1)`; scrim fade 200 ms;
  row press = background `rgba(255,255,255,.045)`; artwork loops as specified above.

## State (Zustand slices)
```
usePlayer   currentId, isPlaying, positionMs, durationMs, source
            play(id, source), toggle(), next(), prev(), seek(ms)
useQueue    items[], enqueueNext(id), remove(i), move(from,to), clear(), setFrom(list)
useLibrary  tracks{}, liked[], toggleLike(id), history[], stats
useAdd      json, preview, error, status
```
`play(id)` must always remove that id from the queue.
`next()` pulls from the queue head; if the queue is empty and the source is
"Liked Songs", playback **stops** — otherwise it continues in the current source.

## Assets
None. No images, no icon font — every glyph in the design is drawn with plain views
(borders, rotated bars, CSS triangles). Reproduce them as small RN components or swap in
a light icon set (Lucide) matched to a 1.6–1.8 dp stroke. Fonts are Google-hosted:
Space Grotesk and Manrope.

## Files in this bundle
- `design/Auric Player.dc.html` — the interactive prototype (open in a browser; it is a
  streaming-HTML component file, the markup near the top is the UI, the class at the
  bottom is the state logic)
- `design/android-frame.jsx` — the device bezel used by the prototype, not part of the app
- `artwork.js` — the deterministic cover generator, ready to drop into the RN app
- `README.md` — this document
