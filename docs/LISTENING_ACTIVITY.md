# Task 9 client activity lifecycle

When the server data source is enabled, likes and product History are loaded
from the Task 9 REST endpoints and cached only in `useLibraryStore`. Like
mutations update that shared state optimistically, suppress duplicate requests,
and roll back only the affected Track on failure.

The player creates a listening session on the first real engine status with
`isPlaying=true`. Loading, restoring, or opening the player does not start one.
The same session survives pause/resume. Elapsed time is sampled from the local
clock only across statuses where the engine was playing; position changes and
seeks never contribute time.

The cumulative `listened_ms` total is checkpointed every 30 seconds of newly
heard audio. A pause checkpoints after at least 5 unreported seconds, and app
backgrounding checkpoints any new time. Individual status gaps are capped at 2
seconds, preventing a suspended or terminated JavaScript runtime from turning
closed-app wall time into listening time.

Pending session snapshots contain only session/Track IDs, context, duration,
positions, the client-observed start time, cumulative listening time, and an
optional terminal reason. They are stored locally for retry. On launch they are
started idempotently if necessary, then finalized with their pending reason or
`app_closed`; recovery never autoplays and never advances the cumulative total.
Legacy pending snapshots infer the earliest start time required by their saved
listened total. End calls are scoped to the native queue-item owner, so a late
callback for an earlier item cannot close its successor's session.

Queue entries retain their initiation context locally. Search, Liked Songs,
History, Play Next, manual queue, resume, random shuffle, Smart Shuffle, and
Quick Picks map to the server's canonical context vocabulary. Queue and current
playback ownership remain local until Task 10.

Mock mode keeps local likes/history and the simulated audio engine. The same
actual-play boundary records mock History, but it makes no activity API calls or
pending-session writes.
