# 008 · Extension stop-recording action

**Status:** spec (proposal confirmed)

## What it does

Adds a symmetric "stop" action to the floating widget so a user can end an in-progress bot recording on
demand, instead of waiting for the meeting to end naturally. A confirmed stop records a `Stop Request`
(`stopRequestedAt`) on the meeting; the worker's existing capture loop picks it up on its next tick and
cuts the recording early. Whatever was captured is transcribed/summarized exactly like a natural end
(`recording → completed`, no new status).

## Why

Today the widget can only invite a bot. Once recording starts there is no in-widget way to stop it, so the
action set is asymmetric and users have no on-demand control over an active capture.

## Requirements

Requirements use RFC 2119 keywords. `Stop Request`, `Single Poller`, and `Meeting Status` are used per
`docs/CONTEXT.md`. Reuse of the `recording → completed` transition is fixed by
`docs/adr/0004-stop-recording-reuses-completed-status.md`.

| # | Requirement |
|---|-------------|
| R1 | The widget stop control MUST be visible only while `status === "recording"`; it MUST be hidden or disabled in every other `Meeting Status`. |
| R2 | The stop control MUST be disabled for the first ~5 seconds after the meeting enters `recording` (computed from the recording-phase timestamp the widget already receives via the 007 Port), and MUST become enabled afterward. The 5s value is a tunable placeholder, not a hard domain constraint. |
| R3 | Activating the stop control MUST require an explicit confirmation step before any message is sent. A single click MUST NOT trigger a stop. |
| R4 | On confirm, the widget MUST optimistically show a "stopping…" state and MUST disable the control immediately to block duplicate sends. The optimistic state MUST resolve only when the 007 Port broadcasts the resulting `completed` (or other terminal) `Meeting Status`. |
| R5 | On confirm, the service worker MUST send a stateless `STOP_BOT` message (carrying the meeting id) to the API client, mirroring the `INVITE_BOT` contract. |
| R6 | The new stop route MUST authenticate identically to `bot/start` (Extension Access Token via `assertExtensionAccessAuthorized`); it MUST NOT perform any per-meeting ownership check. |
| R7 | The stop route MUST set `stopRequestedAt` on the meeting and MUST be idempotent — repeated calls leave a single effective `Stop Request` and MUST NOT error. |
| R8 | The worker's existing capture-loop tick MUST check `stopRequestedAt`; when set, it MUST invoke the existing hardened `stopRecording()` closure once and let the recording finish through the normal `recording → completed` pipeline. |

## Acceptance criteria

- [ ] Stop control is visible and interactive only during `recording`; disabled for the first ~5s, enabled after.
- [ ] Stopping requires confirm — no single-click stop.
- [ ] After confirm the widget shows "stopping…" until the 007 Port broadcasts `completed`.
- [ ] Confirmed stop ends the recording within ~1 worker poll cycle; captured audio is transcribed/summarized normally.
- [ ] Repeated `STOP_BOT` / stop-route calls are idempotent and do not error.
- [ ] No regression to the `INVITE_BOT` flow or the 007 status-sync Port.

## Acceptance scenarios

### Normal stop during active recording

- GIVEN a meeting in `recording` for more than ~5s with the widget open
- WHEN the user activates the stop control and confirms
- THEN the widget shows "stopping…", the stop route sets `stopRequestedAt`, and the worker's next tick calls `stopRecording()`
- AND the meeting transitions `recording → completed`, and the 007 Port broadcast clears the "stopping…" state.

### Stop attempted before the 5s guard elapses

- GIVEN a meeting that entered `recording` less than ~5s ago
- WHEN the user tries to use the stop control
- THEN the control is disabled and no confirm step or `STOP_BOT` message is produced
- AND once ~5s has elapsed the control becomes enabled.

### Double-click / double-submit on the stop control

- GIVEN the user has confirmed a stop
- WHEN the confirm control is activated again (double-click or repeat)
- THEN the control is already disabled and at most one `STOP_BOT` is sent
- AND even if a second stop request reaches the route, `stopRequestedAt` stays a single effective value and the route does not error.

### Stop racing a natural completion

- GIVEN a `Stop Request` is written just before the worker's next poll tick, but the meeting completes naturally first
- WHEN the worker tick runs and finds the recording already ended
- THEN it does not re-trigger `stopRecording()` and produces no error
- AND the meeting remains `completed`; the widget resolves via the Port broadcast the same way.

## Out of scope

- Canceling pre-recording states (`pending` / `joining` / `waiting_admission`) — there is nothing to stop yet.
- Any new `MeetingStatus` enum value or status migration — only an additive nullable `stopRequestedAt` column.
- Per-meeting ownership/ACL checks — `STOP_BOT` inherits `INVITE_BOT`'s origin-level trust (documented pre-existing gap, not fixed here).
- Live/synchronous stop via a worker internal API — the DB-flag + poll mechanism is the chosen approach.
- Distinguishing "user manually stopped" from "natural end" downstream — only a non-null `stopRequestedAt` carries that signal; no dedicated surface is built.
