# 010 · Auto-Join Dedup, Shared Access & Transcription Recovery

**Status:** spec (design decided inline; no sdd-propose/explore ran)
**Branch:** `fix/auto-join-dedup-shared-access-transcription-recovery` (off `dev`)

## Purpose

Three independent but related production bugs, each confirmed against real worker/web/shared source via
log analysis and CodeGraph exploration:

1. **Duplicate recording bots** — a check-then-insert race lets two concurrent auto-join polls enqueue
   the same calendar event twice, so the bot joins one live meeting twice.
2. **Auto-join co-attendees lose access** — after dedup, exactly one registered attendee becomes the
   arbitrary `Owner`; every other registered attendee silently never sees the recording. A scoped domain
   exception (ADR-0007) grants them access automatically.
3. **Transcription failure hides a good video** — the AI post-processing phase runs after the video is
   already uploaded, but its failure collapses into generic `error`, hiding the downloadable video and
   offering a destructive full-rejoin retry instead of the correct reprocess-from-storage retry.

This is a bug-fix change with ONE deliberate scoped domain exception (Problem 2), not a new feature.
Domain vocabulary is fixed by `docs/CONTEXT.md` (sections "Meeting Ownership & Sharing" and
"Meeting Status") and `docs/adr/0007-auto-join-co-attendee-automatic-access-grant.md`. This spec uses
those exact terms — **Owner**, **Access Grant**, **Participant**, **Auto-Join Co-Attendee Grant**,
**Meeting Status** — no synonyms.

---

## Problem 1 — Atomic dedup of auto-join enqueues

### Requirement: Database-level uniqueness on calendar event identity

The system MUST enforce uniqueness of `(source_provider, source_event_id)` in the `meetings` table via a
**partial** unique index restricted to `WHERE source_event_id IS NOT NULL` (partial because
manually-enqueued meetings carry null `sourceEventId`/`sourceProvider`). Enforcement MUST live in the
database, not in application check-then-insert logic.

- **Source:** `packages/shared/src/db/schema.ts:49-50` (plain `text` columns, no index today).
- **Migration:** new file, next number after `drizzle/0006_meeting_ownership_and_sharing.sql` →
  `drizzle/0007_*.sql`.

#### Scenario: Concurrent enqueues of the same event insert exactly one row

- GIVEN two concurrent callers invoke `queueMeetingRun` for the same `(sourceProvider, sourceEventId)`
- WHEN both attempt to insert
- THEN exactly one `meetings` row exists for that pair
- AND the losing caller returns the winner's `meetingId`, not a second row

#### Scenario: Manually-enqueued meetings are exempt

- GIVEN two manually-enqueued meetings with null `sourceEventId`
- WHEN both are inserted
- THEN both rows persist (the partial index does not constrain null `source_event_id`)

### Requirement: `queueMeetingRun` upserts instead of check-then-insert

`queueMeetingRun` (`packages/shared/src/services/meetingQueueService.ts:39-53`) MUST replace the racy
`findBySourceEvent` + `insert` with `INSERT ... ON CONFLICT (source_provider, source_event_id) DO NOTHING`,
then, when the insert is a no-op, re-fetch and return the existing winner's id. The two triggers that race
(worker internal timer `apps/worker/src/runner.ts:12,43-56` at `AUTO_JOIN_POLL_INTERVAL_MS` default
60000ms, and `GET /api/bot/poll` → worker `/internal/auto-join/poll`, plus Railway rolling-deploy overlap)
MUST no longer produce duplicate rows. The atomic claim
(`WorkerMeetingRepository.claimNextPending`, `for update skip locked`) is correct and MUST remain unchanged.

#### Scenario: Second poll of an already-enqueued event dedups to the winner

- GIVEN event E already has a `meetings` row from a prior poll
- WHEN `queueMeetingRun` runs again for E
- THEN no new row is inserted and the existing `meetingId` is returned

**TDD:** live-Postgres test (NOT mocked-module) exercising the unique constraint under concurrency —
follow the established precedent in `apps/__tests__/shared/repositories/user-repository.test.ts` and
`meeting-access-grant-repository.test.ts` (`createLiveConnection` from
`@meeting-bot/shared/db/liveConnection` + `describe.skipIf(!dbAvailable)`), because Bun `mock.module()`
only honors the first registration per specifier per process and cannot test this dedup reliably in CI.
New/extended test file: `apps/__tests__/shared/services/meeting-queue-service.test.ts` (live-DB path).

---

## Problem 2 — Auto-Join Co-Attendee Grant (ADR-0007 exception)

### Requirement: Automatic Access Grant for registered co-attendees of auto-join meetings

Scoped ONLY to auto-join-originated meetings (both `meetings.sourceProvider` and `sourceEventId` set).
For every email in the calendar event's `participantEmails`
(`apps/worker/src/integrations/calendar/types.ts:18`, populated from `event.attendees` in
`GoogleCalendarProvider.ts:156-158`) that matches a registered `users.email`
(`UserRepository.findByEmail`) and is NOT the resolved `Owner`, the system MUST create a
`meeting_access_grants` row via `MeetingAccessGrantRepository.create` with **no expiry** (indefinite,
manually revocable like any other grant). The `Owner` MUST NOT be derived from `organizerEmail`
(`docs/CONTEXT.md`: "No se deriva de organizerEmail"). This runs in
`apps/worker/src/services/autoJoinService.ts` right after `queueMeetingRun` returns — whether it inserted
or deduped — since a later poll may be the first time a different co-attendee email surfaces.

Manually-enqueued meetings (`INVITE_BOT`, dashboard/chat `enqueue_meeting`) MUST be completely unaffected:
`Participant` there stays suggestion-only per the 009 model.

#### Scenario: Non-owner registered attendee is auto-granted access

- GIVEN an auto-join meeting where attendees A and B are both registered users and A won the insert race as `Owner`
- WHEN the auto-join service processes the event
- THEN a `meeting_access_grants` row is created for B with null `expiresAt`
- AND B can list and open the meeting despite not being `Owner`

#### Scenario: Grant applies even if the co-attendee never enabled their own auto-join

- GIVEN registered user B appears as an attendee but never connected/enabled Google Calendar auto-join
- WHEN the auto-join service processes the triggering event
- THEN B is still granted access (matching a registered email is the only bar)

#### Scenario: Unregistered attendees and the Owner are skipped

- GIVEN an attendee email with no matching `users.email`, and the resolved `Owner`'s own email
- WHEN the auto-join service processes the event
- THEN no grant is created for the unregistered email and none for the `Owner`

### Requirement: Idempotent, revocation-respecting grant creation

Grant creation MUST be idempotent across repeated polls of the same event and MUST NOT re-create a grant
if ANY row already exists for that `(meetingId, granteeUserId)` pair — even if the `Owner` manually
revoked it. The check MUST be "does any row exist at all", NOT "does a live/non-revoked row exist". This
requires a new repository method, e.g. `MeetingAccessGrantRepository.existsForMeetingAndGrantee(meetingId,
granteeUserId): Promise<boolean>`.

#### Scenario: Repeated polls do not duplicate grants

- GIVEN B already has a grant row on the meeting
- WHEN the ~60s auto-join poller re-scans the same event
- THEN no additional grant row is created

#### Scenario: Deliberately revoked grant is not resurrected

- GIVEN the `Owner` manually revoked B's grant (`revokedAt` set)
- WHEN a later poll of the same event runs
- THEN the revoked grant MUST NOT be re-created

**TDD:** extend `apps/__tests__/shared/repositories/meeting-access-grant-repository.test.ts` (live-DB) for
`existsForMeetingAndGrantee`; new `apps/__tests__/worker/services/autoJoinService.test.ts` (or extend the
existing auto-join test) for the grant-creation branch, matching-email filtering, Owner exclusion, and
idempotency.

---

## Problem 3 — Transcription failure is a recoverable state, video stays visible

### Requirement: New recoverable `transcription_error` status

The system MUST add a `transcription_error` value to `meetingStatusEnum`
(`packages/shared/src/db/schema.ts`) via an additive `ALTER TYPE ... ADD VALUE` migration (`drizzle/0007`
scope or its own numbered file — additive, unlike 009's enum recreate). In
`packages/shared/src/domain/meetingStatus.ts` it MUST be added to the `MeetingStatus` union, to
`ALLOWED_TRANSITIONS` as **recoverable** (may transition to `transcribing`/`summarizing`/`completed`,
unlike terminal `error`/`rejected`), and to `MEETING_STATUS_LABELS_ES` with label
`"Error de transcripción"`. It MUST NOT be added to `ACTIVE_PROCESSING_STATUSES` (it is an actionable
resolved-ish state, same bucket as `error`/`rejected`).

#### Scenario: transcription_error is recoverable, not terminal

- GIVEN a meeting in status `transcription_error`
- WHEN a transition to `transcribing`/`summarizing`/`completed` is validated
- THEN the transition is allowed (whereas `error`/`rejected` require restarting from `pending`)

### Requirement: AI post-processing failure sets transcription_error, not error

In `apps/worker/src/services/meetingWorkerService.ts`, the video is uploaded and
`recordingFilePath`/`recordingStorageKey` persisted (~lines 120-126) BEFORE the AI phase. When the AI
transcription/summary phase throws, its catch block (~lines 165-173) MUST set
`status: "transcription_error"` instead of generic `"error"`. The outer catch for real recording/join
failures (~lines 174-193), where no video was ever produced, MUST keep `"error"` — unchanged.

#### Scenario: AI failure after a good recording yields transcription_error

- GIVEN a meeting whose video uploaded successfully and `recordingFilePath` is set
- WHEN the AI transcription/summary phase throws
- THEN status becomes `transcription_error` (not `error`)

#### Scenario: Join/recording failure still yields error

- GIVEN a meeting that failed to join or record (no video produced)
- WHEN the outer catch handles it
- THEN status remains `error`

### Requirement: Video visibility gated on file presence, not completed status

In `apps/web/src/components/MeetingDetailsView.tsx`, the video player (~line 703) and MP4 download link
(~line 656) MUST gate on `meeting.recordingFilePath` being truthy instead of `status === "completed"`, so
a stored video shows regardless of status.

#### Scenario: Video shows on transcription_error

- GIVEN a meeting in `transcription_error` with `recordingFilePath` set
- WHEN the Owner opens the detail view
- THEN the video player and MP4 download are available

### Requirement: Reprocess (not full rejoin) offered for transcription_error

`canReprocess` MUST additionally be true when `status === "transcription_error"` (in addition to today's
`status === "completed" && (!rawTranscription || !summary)`), still requiring `recordingFilePath` present,
reusing the existing `handleReprocess`/`reprocessMeetingAction` wiring (`MeetingDetailsView.tsx:116-133`)
and `reprocessMeetingService` (`meetingRecoveryService.ts:19-91`) as-is — no new button, no new action.
`handleReprocess`'s failure-rollback (~lines 120,125,129) MUST restore the meeting's pre-optimistic status
(now possibly `transcription_error`) instead of hardcoding `"completed"`. The destructive full-rejoin
retry (`status === "error" || "rejected"` → `retryMeetingAction` → `retryRejectedMeeting`,
`meetingRecoveryService.ts:94-110`, line ~641) MUST NOT match `transcription_error`.

#### Scenario: Reprocess retries from storage without rejoining

- GIVEN a meeting in `transcription_error` with `recordingFilePath` set
- WHEN the Owner triggers reprocess
- THEN `reprocessMeetingTranscription` retries transcription/summary from the stored recording, never rejoining the live meeting

#### Scenario: Failed reprocess restores the prior status

- GIVEN a `transcription_error` meeting whose optimistic reprocess fails
- WHEN the rollback runs
- THEN the UI status is restored to `transcription_error`, not `completed`

#### Scenario: transcription_error does not offer the destructive rejoin retry

- GIVEN a meeting in `transcription_error`
- WHEN the detail view renders
- THEN the `retryMeetingAction` full-rejoin button MUST NOT appear

### Requirement: Dashboard filtering and badge for transcription_error

In `apps/web/src/components/DashboardClient.tsx`, `transcription_error` MUST fold into the existing
"Con Error" status filter tab (no new tab) and MUST render with a distinct badge variant from plain
`error` (e.g. `"warning"` instead of `"destructive"`), since the recording is fine and only
post-processing needs a retry.

#### Scenario: transcription_error appears under the error filter with a warning badge

- GIVEN a meeting in `transcription_error`
- WHEN the dashboard "Con Error" filter is active
- THEN the meeting appears with a `warning`-variant badge distinct from `error`'s `destructive`

**TDD:** extend `apps/__tests__/shared/domain/meetingStatus.test.ts` for the union/transitions/label/
active-set assertions; extend the worker service test for the catch-block status; web component gating and
`canReprocess`/rollback assertions belong to the mirrored web test area
(`apps/__tests__/web/...`) per the AGENTS.md TDD mandate. Purely visual badge styling falls under the
manual/visual exception.

---

## Non-Goals

- **Reworking the atomic claim** (`claimNextPending`) — it is already correct (`for update skip locked`).
- **Owner selection by calendar organizer** — `Owner` stays race-decided; `organizerEmail` MUST NOT drive it.
- **Auto-grants for manually-enqueued meetings** — `INVITE_BOT`/dashboard/chat stay suggestion-only (009).
- **Auto-grants for unregistered attendees** — only registered `users.email` matches qualify.
- **Backfilling grants for historical auto-join meetings** — behavior applies going forward.
- **Touching deployment-contract files** — no `Dockerfile.*`, `docker-compose*.yml`, `railway.json`, or CI changes.

## Migration Note

Migrations land as `drizzle/0007_*.sql` (partial unique index on `meetings (source_provider,
source_event_id) WHERE source_event_id IS NOT NULL`, plus the additive `ALTER TYPE meeting_status ADD
VALUE 'transcription_error'`). Adding an enum value is straightforward and does not require recreating the
type (unlike 009, which recreated it to remove a value). Pre-existing `error` rows are not retroactively
reclassified.
