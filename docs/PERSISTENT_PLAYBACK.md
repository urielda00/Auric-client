# Persistent queue and playback

In real mode, `playbackStateService` is the synchronization boundary between Zustand
stores and `/api/v1/playback-state`. UI components continue to call queue/player
actions and never call playback endpoints directly.

The client keeps a compact local snapshot and cached canonical Track DTOs for
immediate/offline recovery. A successful server hydration is authoritative; only a
pristine revision-zero server is seeded from pre-existing local state. Writes are
serialized, carry the last server revision, and refetch on
`PLAYBACK_STATE_CONFLICT`. Hydration and audio generation guards prevent late
responses from replacing a newer local Track. Stable item IDs follow an occurrence
from upcoming to current to the played stack.

Startup restores current Track, queue items, played stack, contexts, and position,
then loads and seeks the audio engine without autoplay. Position checkpoints occur at
most every 15 seconds while playing and explicitly on pause, seek, background, and
Track changes. Mock mode never requires the server and continues using local storage.

Listening-session analytics are independent: queue synchronization does not emit
listening events or change Task 9 end-reason handling.
