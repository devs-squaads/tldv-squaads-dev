# Stop Recording Reuses the Existing `completed` Transition

Manually stopping a bot's recording from the extension widget does not introduce a new `MeetingStatus`
value. It reuses the `recording → completed` transition that already exists for meetings with no
transcription provider configured (`meetingWorkerService.ts`). A `Stop Request` (see `docs/CONTEXT.md`)
is recorded as `stopRequestedAt` on the meeting row; the worker's already-ticking capture loop checks it
and calls the existing internal `stopRecording()` early. Whatever was captured up to that point is
transcribed/summarized exactly as a naturally-ended recording would be — there is no separate "the user
cut this short" outcome in the data.

`STOP_BOT` also inherits the same trust level as `INVITE_BOT`: a valid Extension Access Token for the
origin, with no per-meeting ownership check. Meetings have no `createdBy`/`invitedBy` column, so any tab
with a connected extension can stop a recording it did not start — same as it can invite one today.

## Status

accepted

## Considered Options

- **New terminal status (`stopped`/`cancelled`), still transcribed**: rejected — same downstream pipeline
  as reusing `completed`, but adds an enum value, a DB migration, and a new transition just to label the
  outcome differently. No product requirement surfaced that needs to distinguish "stopped" from
  "completed" in the dashboard today.
- **New terminal status that skips transcription/summary entirely**: rejected — bigger change (a second
  branch through the worker's pipeline) for a behavior nobody asked for; the user explicitly wants
  whatever was captured before the stop to be processed normally.
- **Meeting ownership (`createdBy`) gating `STOP_BOT`**: rejected for this change — closing the gap means
  designing ownership for meetings repo-wide, which is bigger than "add a stop button" and belongs in its
  own change. Tracked as a known, pre-existing gap rather than introduced debt.

## Consequences

- No schema change to `meeting_status`; only an additive `stopRequestedAt` timestamp column on `meetings`,
  consistent with the existing `startsAt`/`endsAt` convention.
- A manually-stopped recording is indistinguishable from a naturally-completed one in the data. If the
  product later needs to report "how many recordings were user-stopped," that requires a follow-up change
  (new column or status) — this ADR does not preclude it, it just doesn't build it now.
- `STOP_BOT` is only meaningful while `status === "recording"`; before that (pending/joining/
  waiting_admission) there is nothing to stop, and canceling an in-progress join is explicitly out of
  scope for this change.
- The no-ownership gap is inherited, not created, by this change. Any future fix (e.g. adding
  `invitedBy`/`createdBy` to `meetings`) will close it for both `INVITE_BOT` and `STOP_BOT` at once, since
  they share the same auth path.
