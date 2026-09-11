# Recommendations and Stats client

With `EXPO_PUBLIC_AURIC_USE_MOCKS=true` (or without an API URL), Home, both
shuffle modes, and Stats retain local development behavior. In real mode the
client uses the Task 11 endpoints and maps every returned Track through the
canonical Track DTO mapper.

Home requests Quick Picks after library hydration and on pull-to-refresh. A
request generation plus `AbortController` prevents an older refresh from
winning. Successful results are cached; if the server is offline the last
successful set remains visible and is marked internally as cached. Selecting a
pick uses the existing player with `quick_pick` context; displaying one records
nothing.

Smart and Random share a request-generation coordinator. It suppresses a
duplicate press, makes a newer mode invalidate the older response, and is
invalidated by any manual `play` call. Only the current response may hydrate the
library cache, replace the Task 10 upcoming queue, and activate its first Track.
That transition is immediately persisted by the existing playback-state
coordinator. Smart uses `smart_shuffle`; Random uses `random_shuffle`. A failed
request leaves the existing queue untouched and shows an explicit retryable
message.

Stats loads one UTC year-to-date server summary, caches its last successful value, and retains
the approved hero, four tiles, top-five bars, and rediscovery chips. The library
count, liked count, unique-listened count, listening time, play counts, and
rediscoveries all come from the summary; no production statistic is hardcoded.
