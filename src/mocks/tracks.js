/**
 * Mock music library. Stands in for the ~1,600-1,700 track home-server library described
 * in the design brief. Nothing here is real audio — services/musicService.js is the only
 * thing screens should import; this file is its (current) data source.
 *
 * Track shape:
 *   id            stable string id (NOT a filename)
 *   title         string
 *   artists       string[]
 *   version       string|null          e.g. "Sped Up", "Acoustic", "Remix"
 *   album         string
 *   releaseYear   number
 *   durationMs    number
 *   visualSeed    string                fed to trackArt() for deterministic cover art
 *   aliases       string[]              alternate spellings/nicknames for search
 *   playWeight    number 0-1            mock signal: how "in rotation" this track is
 *   lastPlayedDaysAgo  number|null      mock signal: recency, null = never
 *   likedSeed     boolean               initial liked state before any user interaction
 */

const RAW = [
  // [title, artists[], version, album, year, durationMs, playWeight, lastPlayedDaysAgo, likedSeed, aliases?]
  ['Neon Provinces', ['Halva Kite'], null, 'Provinces', 2019, 243000, 0.92, 1, true],
  ['Slow Cartography', ['Émile Ruo'], null, 'Atlas Skin', 2021, 198000, 0.35, 96, true, ['emile', 'cartography']],
  ['Paper Radio', ['The Long Winter'], null, 'Paper Radio', 2016, 274000, 0.12, 210, false],
  ['Marble Dust', ['Anouk Sever'], null, 'Marble Dust', 2020, 211000, 0.88, 2, false, ['marbel']],
  ['Second Language', ['Vela Nine'], null, 'Vela', 2018, 186000, 0.4, 60, true, ['nine']],
  ['Harbour Lights, 4am', ['Tobias Krum'], null, 'Night Shift', 2017, 305000, 0.1, 190, false, ['harbor']],
  ['Glasshouse', ['Miri Adán'], null, 'Glasshouse', 2022, 229000, 0.86, 3, true],
  ['Everything Twice', ['Faro'], null, 'Everything Twice', 2015, 194000, 0.5, 45, true],
  ['Undertow', ['Nils Bergmann'], null, 'Undertow', 2014, 262000, 0.08, 240, false],
  ['Static Bloom', ['Halva Kite'], null, 'Provinces', 2019, 217000, 0.83, 4, false],
  ['Low Orbit', ['Cassette Sun'], null, 'Low Orbit', 2023, 241000, 0.55, 30, true],
  ['Winter Palette', ['Émile Ruo'], null, 'Atlas Skin', 2021, 256000, 0.09, 205, false, ['emile']],
  ['Telegram', ['Vela Nine'], null, 'Vela', 2018, 172000, 0.79, 5, false],
  ['Amber Hour', ['Miri Adán'], null, 'Glasshouse', 2022, 288000, 0.44, 52, true],
  ['Northline', ['Faro'], null, 'Everything Twice', 2015, 203000, 0.11, 225, false],
  ['Quiet Machines', ['Cassette Sun'], null, 'Low Orbit', 2023, 231000, 0.81, 6, false],
  ['Blue Hour Drive', ['Tobias Krum'], null, 'Night Shift', 2017, 219000, 0.41, 58, true],
  ['Salt & Signal', ['Anouk Sever'], null, 'Marble Dust', 2020, 247000, 0.1, 260, false],
  ['Sped Up in Traffic', ['Halva Kite'], 'Sped Up', 'Provinces', 2019, 168000, 0.6, 20, false],
  ['Marble Dust', ['Anouk Sever'], 'Acoustic', 'Marble Dust (Sessions)', 2020, 198000, 0.28, 88, true],
  ['Second Language', ['Vela Nine'], 'Slowed + Reverb', 'Vela', 2018, 233000, 0.36, 70, false],
  ['Glasshouse', ['Miri Adán'], 'Remix', 'Glasshouse (Remixes)', 2022, 214000, 0.7, 9, true],
  ['Harbour Lights, 4am', ['Tobias Krum'], 'VIP Mix', 'Night Shift', 2017, 318000, 0.15, 150, false],
  ['Coastline, Repeating', ['Sigrún Waltari'], null, 'Coastline', 2013, 251000, 0.06, 300, false],
  ['İkinci Gece', ['Deniz Kaya'], null, 'İkinci Gece', 2021, 207000, 0.63, 14, true],
  ['Anaïs, Unfinished', ['Anaïs Coeur'], null, 'Half Portraits', 2019, 189000, 0.32, 100, false],
  ['Monsoon Static', ['Ravi Chandran'], null, 'Monsoon Static', 2020, 264000, 0.47, 40, false],
  ['Nine Days Blank', ['Vela Nine', 'Faro'], null, 'Split Sides', 2022, 221000, 0.9, 1, true],
  ['A Room With No Radio', ['The Quiet Static'], null, 'A Room With No Radio', 2011, 296000, 0.05, 320, false],
  ['Noor at Noon', ['Noor Al-Sabah'], null, 'Noor at Noon', 2023, 199000, 0.72, 8, false],
  ['Everything, Slower', ['Faro'], 'Slowed + Reverb', 'Everything Twice', 2015, 259000, 0.22, 130, false],
  ['Marisol', ['Marisol Vega'], null, 'Marisol', 2017, 176000, 0.38, 66, true],
  ['Static Bloom', ['Halva Kite'], 'Live at Meridian', 'Provinces (Live)', 2020, 234000, 0.14, 175, false],
  ['Otis, Unraveling', ['Otis Rimm'], null, 'Otis, Unraveling', 2018, 243000, 0.29, 92, false],
  ['Kwiat i Beton', ['Kacper Wiśniewski'], null, 'Kwiat i Beton', 2021, 212000, 0.66, 12, true],
  ['Paper Cranes, Falling', ['Yuki Amano'], null, 'Paper Cranes', 2016, 191000, 0.2, 160, false],
  ['Second Skin', ['Priya Nathan'], null, 'Second Skin', 2022, 227000, 0.76, 7, true],
  ['Static / Bloom', ['Halva Kite', 'Cassette Sun'], 'Remix', 'Provinces (Remixes)', 2019, 245000, 0.53, 33, false],
  ['Sable Weather', ['Wren & Sable'], null, 'Sable Weather', 2020, 269000, 0.31, 104, false],
  ['Ben-David & Faro', ['Lior Ben-David', 'Faro'], null, 'Two Names', 2023, 214000, 0.85, 3, true],
  ['Everything Twice', ['Faro'], 'Acoustic', 'Everything Twice (Sessions)', 2016, 205000, 0.18, 140, false],
  ['Small Hours', ['Cassette Sun'], null, 'Low Orbit', 2023, 238000, 0.61, 18, false],
  ['Rooftop, Unlisted', ['The Long Winter'], null, 'Paper Radio', 2016, 281000, 0.07, 280, false],
  ['Vela Nine, Reprise', ['Vela Nine'], 'Reprise', 'Vela', 2018, 132000, 0.24, 118, true],
  ['Marble', ['Anouk Sever'], 'Demo', 'Marble Dust (Sessions)', 2020, 154000, 0.16, 165, false],
  ['Everything I Meant to Say Before You Left for Good', ['Miri Adán'], null, 'Glasshouse', 2022, 297000, 0.68, 11, true],
  ['4am', ['Tobias Krum'], 'Sped Up', 'Night Shift', 2017, 145000, 0.49, 42, false],
  ['Undertow, Reprise', ['Nils Bergmann'], 'Reprise', 'Undertow', 2014, 121000, 0.13, 198, false],
  ['Halva', ['Halva Kite'], null, 'Provinces', 2019, 183000, 0.58, 25, false],
  ['Cold Open', ['Otis Rimm', 'Priya Nathan'], null, 'Cold Open', 2024, 202000, 0.94, 0, true],
  ['Görünmez', ['Deniz Kaya'], 'Acoustic', 'İkinci Gece (Sessions)', 2021, 187000, 0.27, 112, false],
  ['Long Winter, Reprise', ['The Long Winter'], 'Reprise', 'Paper Radio', 2016, 98000, 0.05, 340, false],
  ['Waltari Nights', ['Sigrún Waltari'], 'Live', 'Coastline (Live)', 2014, 273000, 0.09, 230, false],
  ['Rimm', ['Otis Rimm'], null, 'Otis, Unraveling', 2019, 165000, 0.34, 80, false],
  ['One More Winter', ['The Long Winter', 'Anouk Sever'], null, 'One More Winter', 2024, 219000, 0.97, 0, true],
  ['Chandran Hours', ['Ravi Chandran'], 'Remix', 'Monsoon Static (Remixes)', 2020, 249000, 0.42, 55, false],
  ['Faro & Nine', ['Faro', 'Vela Nine'], 'Live at Meridian', 'Split Sides (Live)', 2022, 226000, 0.39, 62, false],
  ['Amano, Slower', ['Yuki Amano'], 'Slowed + Reverb', 'Paper Cranes', 2016, 236000, 0.19, 155, false],
];

export const MOCK_TRACKS = RAW.map((row, i) => {
  const [title, artists, version, album, releaseYear, durationMs, playWeight, lastPlayedDaysAgo, likedSeed, aliases] = row;
  const id = `t${String(i + 1).padStart(3, '0')}`;
  return {
    id,
    title,
    artists,
    version: version || null,
    album,
    releaseYear,
    durationMs,
    visualSeed: id,
    aliases: aliases || [],
    playWeight,
    lastPlayedDaysAgo: lastPlayedDaysAgo === null ? null : lastPlayedDaysAgo,
    likedSeed: !!likedSeed,
  };
});

export default MOCK_TRACKS;
