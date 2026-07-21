# Design: Auto-Join Dedup, Shared Access & Transcription Recovery

## Technical Approach

Three independent root-cause fixes, each landing at the one choke point every affected code path already
funnels through — consistent with 009's approach, not three scattered patches:

1. **Dedup** moves from racy application-level check-then-insert to a DB-level partial unique index +
   `INSERT ... ON CONFLICT DO NOTHING` in `MeetingRepository`, with `queueMeetingRun` re-fetching the
   winner on conflict. The atomic claim (`claimNextPending`, `for update skip locked`) is untouched — this
   fixes enqueue-time duplication, not claim-time.
2. **Co-attendee grant** is a new, narrowly-scoped write appended to `autoJoinService` right after
   `queueMeetingRun` resolves (inserted-or-deduped), reusing `UserRepository.findByEmail` and
   `MeetingAccessGrantRepository.create` from 009 verbatim, plus one new idempotency-check method.
   Owner resolution itself is unchanged.
3. **Transcription recovery** adds one enum value (`transcription_error`) treated as recoverable (not
   terminal) in the existing state-machine module, and re-points four already-existing UI gates
   (video, download, `canReprocess`, rollback) from `status === "completed"` to `recordingFilePath`
   presence / status-inclusive checks — no new component, no new server action.

## Open Technical Question — Resolved: split into two migration files

**Question:** Can the partial unique index and the new `transcription_error` enum value ship in one
`drizzle/0007_*.sql`, given Postgres forbids `ALTER TYPE ... ADD VALUE` and using that value in the same
transaction?

**Finding:** This repo's existing enum-add-value precedent, `drizzle/0001_add_rejected_status.sql`, is a
single-statement file containing only `ALTER TYPE "public"."meeting_status" ADD VALUE IF NOT EXISTS
'rejected';` — isolated from every other migration, even though nothing else in that migration batch
referenced the new value. `drizzle/0006_meeting_ownership_and_sharing.sql` shows this repo's migration
runner executes each numbered file's statements (separated by `--> statement-breakpoint`) together, and
`0001`'s isolation is the only prior data point for how this repo treats `ADD VALUE`. Nothing in this
change needs the partial unique index and the enum value to co-occur — they are unrelated schema objects
touching different tables — so there is no correctness requirement to combine them, and the safe,
convention-consistent choice is to keep the isolation precedent for `ADD VALUE` migrations.

**Decision:** Split into two files:
- `drizzle/0007_meeting_dedup_index.sql` — partial unique index only.
- `drizzle/0008_transcription_error_status.sql` — `ALTER TYPE "public"."meeting_status" ADD VALUE IF NOT
  EXISTS 'transcription_error';` only, mirroring `0001`'s shape exactly.

This also sidesteps any ambiguity about whether this repo's runner wraps a whole file in one transaction
(if it does, combining would be a hard Postgres error the moment anything in the same file referenced the
new value — moot here, but not worth introducing as a precedent) or not.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Migration file split | Two files, `0007` (index) + `0008` (enum value), matching `0001`'s isolation precedent | One combined `0007` | No correctness requirement to combine; matches this repo's only prior `ADD VALUE` precedent instead of inventing a new pattern |
| Dedup enforcement point | DB-level partial unique index + `ON CONFLICT DO NOTHING`, arbiter logic inside `MeetingRepository` | Advisory lock in `queueMeetingRun`; app-level re-check-before-insert (today's racy approach) | Root-cause fix per AGENTS.md — DB constraint is the only mechanism immune to two processes racing between check and insert; `MeetingRepository` already owns every other query-shape concern (mirrors `findBySourceEvent`, `insert`), keeping `queueMeetingRun` free of SQL/conflict-target details |
| Conflict-target construction | Drizzle query builder `.onConflictDoNothing({ target: [...], where: isNotNull(...) })`, not raw SQL | Raw `db.execute(sql\`INSERT ... ON CONFLICT ...\`)` | Every other repository method in this file uses the query builder; raw SQL would be the only exception for no correctness gain — Postgres requires the arbiter's `where` to match the partial index's predicate exactly regardless of which drizzle API constructs it |
| `queueMeetingRun` return shape | Extend to `{ id: string; ownerId: string }` | Have `autoJoinService` re-fetch the meeting by id to learn the winning `ownerId` | The repository methods already have the winning row (freshly inserted or re-fetched-on-conflict) in hand; returning it avoids a second round-trip and keeps `autoJoinService` from needing to know about `MeetingRepository` at all |
| Co-attendee grant idempotency check | New `MeetingAccessGrantRepository.existsForMeetingAndGrantee(meetingId, granteeUserId)` — "any row at all", ignoring `revokedAt` | Reuse `findLiveGrant` (checks `revokedAt IS NULL`) | Spec requires a manually revoked grant to stay revoked; `findLiveGrant`'s semantics are the wrong question (checks "is currently live", not "was ever created") — a distinct method keeps both queries honest about what they answer |
| Grant creation location | Inline in `autoJoinPollAndEnqueue`'s per-event loop, right after `queueMeetingRun` resolves | New `AutoJoinGrantService` module | YAGNI — one loop, two repository calls, no branching complexity that justifies a new file; mirrors how owner resolution already lives inline in the same function |
| `transcription_error` bucket | Own bucket alongside `error`/`rejected` (actionable, not `ACTIVE_PROCESSING_STATUSES`), but recoverable in `ALLOWED_TRANSITIONS` (unlike `error`/`rejected`, which only recover via `pending`) | Add to `ACTIVE_PROCESSING_STATUSES` (would spuriously trigger the dashboard's polling `setInterval`) | The recording is done; only the transcript/summary needs another pass, so it should behave like a resolved-but-actionable state, not an in-progress one |
| Video/download/`canReprocess` gating | Switch to `meeting.recordingFilePath` truthiness (video/download) and explicit status-set checks (`canReprocess`) instead of `status === "completed"` | Add `transcription_error` as a parallel `||` branch everywhere `completed` appears | Truthiness-on-file-presence is the actual invariant the UI cares about ("is there a video to show"), and is already correct for any future recoverable-with-video status without another `||` branch |
| Rollback status on failed reprocess | Capture `meeting.status` at the moment `handleReprocess` starts (before the optimistic `"transcribing"` set), restore that captured value on failure | Keep hardcoded `"completed"` and add an `if` for `transcription_error` | A captured pre-optimistic value is correct for both existing callers of `canReprocess` (`completed` and now `transcription_error`) with one line, not two hardcoded branches that must be kept in sync |

## Data Flow

    Auto-join poll (worker/src/services/autoJoinService.ts, ~60s + /internal/auto-join/poll)
      │
      ▼
    queueMeetingRun({ sourceProvider, sourceEventId, ownerId: event.ownerUserId, ... })
      │
      ├─ sourceProvider && sourceEventId set ──▶ MeetingRepository.insertDedupedBySourceEvent(values)
      │                                            │
      │                                            ├─ INSERT ... ON CONFLICT (source_provider, source_event_id)
      │                                            │   WHERE source_event_id IS NOT NULL DO NOTHING RETURNING *
      │                                            │
      │                                            ├─ row returned ──▶ this call won the race
      │                                            └─ no row ──▶ findBySourceEvent(...) ──▶ winner's row
      │                                            (either way: { id, ownerId } of the ONE persisted row)
      │
      └─ manual paths (no sourceEventId) ──▶ existing dedupe-window + plain insert, unchanged

    { id: meetingId, ownerId: resolvedOwnerId } = queueMeetingRun(...)
      │
      ▼
    for email of event.participantEmails:
      UserRepository.findByEmail(email) ──▶ user | null
      user && user.id !== resolvedOwnerId
        ──▶ MeetingAccessGrantRepository.existsForMeetingAndGrantee(meetingId, user.id)
              false ──▶ MeetingAccessGrantRepository.create({ meetingId, ownerId: resolvedOwnerId,
                          granteeUserId: user.id, expiresAt: null, revokedAt: null })
              true  ──▶ skip (already granted, or deliberately revoked — never re-created)

    Worker AI phase throws (meetingWorkerService.ts, AFTER upload succeeded)
      ──▶ status: "transcription_error" (was "error")
    Worker join/record phase throws (no video ever produced)
      ──▶ status: "error" (unchanged)

    MeetingDetailsView renders:
      recordingFilePath truthy ──▶ video player + MP4 download shown (any status)
      status ∈ {completed, transcription_error} && (missing transcript/summary) && recordingFilePath
        ──▶ canReprocess ──▶ handleReprocess ──▶ reprocessMeetingAction (unchanged, storage-based retry)
      status ∈ {rejected, error} (NOT transcription_error) ──▶ retryMeetingAction (destructive full rejoin)

    DashboardClient: transcription_error folds into "Con Error" filter tab, renders with "warning" badge
      (not "destructive") — recording is fine, only post-processing needs a retry.

## File Changes

| File | Action | Description |
|---|---|---|
| `packages/shared/src/db/schema.ts` | Modify | `meetingStatusEnum` gains `"transcription_error"` (order after `"error"`, before `"rejected"` is irrelevant to Postgres enums but kept adjacent to `"error"` for readability); add partial unique index on `meetings(sourceProvider, sourceEventId)` via `.enableRLS()`-style `index()` builder with `.where(...)` |
| `drizzle/0007_meeting_dedup_index.sql` | Create | `CREATE UNIQUE INDEX ... ON "meetings" ("source_provider", "source_event_id") WHERE "source_event_id" IS NOT NULL;` |
| `drizzle/0008_transcription_error_status.sql` | Create | `ALTER TYPE "public"."meeting_status" ADD VALUE IF NOT EXISTS 'transcription_error';` (mirrors `0001`) |
| `packages/shared/src/repositories/MeetingRepository.ts` | Modify | New `insertDedupedBySourceEvent(values): Promise<MeetingRecord>` — `onConflictDoNothing` + refetch-on-conflict |
| `packages/shared/src/services/meetingQueueService.ts` | Modify | `queueMeetingRun` return type becomes `{ id: string; ownerId: string }`; source-event branch calls `insertDedupedBySourceEvent` instead of `findBySourceEvent` + `insert` |
| `packages/shared/src/repositories/MeetingAccessGrantRepository.ts` | Modify | New `existsForMeetingAndGrantee(meetingId, granteeUserId): Promise<boolean>` |
| `apps/worker/src/services/autoJoinService.ts` | Modify | After `queueMeetingRun` resolves: loop `event.participantEmails`, resolve via `UserRepository.findByEmail`, skip `Owner`/unregistered/already-granted, create grant |
| `packages/shared/src/domain/meetingStatus.ts` | Modify | `MeetingStatus` union, `ALLOWED_TRANSITIONS`, `MEETING_STATUS_LABELS_ES` gain `transcription_error`; `ACTIVE_PROCESSING_STATUSES` unchanged (does NOT include it) |
| `apps/worker/src/services/meetingWorkerService.ts` | Modify | Inner AI-phase catch block (~line 165-173) sets `status: "transcription_error"` instead of `"error"`; outer catch (~174-193, join/record failures) unchanged |
| `apps/web/src/components/MeetingDetailsView.tsx` | Modify | Video gate (~703) and MP4 download gate (~656) switch from `status === "completed"` to `meeting.recordingFilePath` truthy; `canReprocess` (~116) adds `transcription_error`; `handleReprocess` (~118-133) captures pre-optimistic status for rollback instead of hardcoding `"completed"` |
| `apps/web/src/components/DashboardClient.tsx` | Modify | `getStatusVariant` (~40-50) returns `"warning"` for `transcription_error`; filter predicate (~85-89) folds `transcription_error` into the `"error"` tab alongside `m.status === "error"` |

## Interfaces / Contracts

```typescript
// packages/shared/src/repositories/MeetingRepository.ts
import { isNotNull } from "drizzle-orm";

export class MeetingRepository {
  // ...existing methods unchanged...

  /**
   * Atomically inserts a meeting keyed by (sourceProvider, sourceEventId), relying on the
   * partial unique index. On conflict (event already enqueued by a concurrent poll), re-fetches
   * and returns the existing winner instead of inserting a duplicate row.
   */
  static async insertDedupedBySourceEvent(values: MeetingInsert): Promise<MeetingRecord> {
    const [inserted] = await db
      .insert(meetings)
      .values(values)
      .onConflictDoNothing({
        target: [meetings.sourceProvider, meetings.sourceEventId],
        where: isNotNull(meetings.sourceEventId), // mirrors the partial index predicate
      })
      .returning();

    if (inserted) return inserted;

    const existing = await MeetingRepository.findBySourceEvent(
      values.sourceProvider as string,
      values.sourceEventId as string,
    );
    if (!existing) {
      throw new Error(
        `insertDedupedBySourceEvent: conflict reported but no existing row found for ${values.sourceProvider}/${values.sourceEventId}`,
      );
    }
    return existing;
  }
}
```

```typescript
// packages/shared/src/services/meetingQueueService.ts
export async function queueMeetingRun(params: StartMeetingParams): Promise<{ id: string; ownerId: string }>;
// Source-event branch (sourceProvider && sourceEventId && !meetingId):
//   const record = await MeetingRepository.insertDedupedBySourceEvent({ id, ownerId, ...rest });
//   return { id: record.id, ownerId: record.ownerId };
// All other branches (existing manual dedupe-window, fresh insert, explicit meetingId):
//   return { id, ownerId } using the already-known ownerId (unchanged shape, just widened return type).
```

```typescript
// packages/shared/src/repositories/MeetingAccessGrantRepository.ts
export class MeetingAccessGrantRepository {
  // ...existing methods unchanged...

  /** "Does any row exist at all" — deliberately ignores revokedAt/expiresAt (idempotency, not liveness). */
  static async existsForMeetingAndGrantee(meetingId: string, granteeUserId: string): Promise<boolean> {
    const [row] = await db
      .select({ id: meetingAccessGrants.id })
      .from(meetingAccessGrants)
      .where(
        and(
          eq(meetingAccessGrants.meetingId, meetingId),
          eq(meetingAccessGrants.granteeUserId, granteeUserId),
        ),
      )
      .limit(1);
    return Boolean(row);
  }
}
```

```typescript
// apps/worker/src/services/autoJoinService.ts — appended after the existing queueMeetingRun call
const { id: meetingId, ownerId: resolvedOwnerId } = await queueMeetingRun({ /* ...unchanged params... */ });
enqueued += 1;

for (const rawEmail of event.participantEmails ?? []) {
  const email = rawEmail.trim().toLowerCase();
  if (!email) continue;

  const user = await UserRepository.findByEmail(email);
  if (!user || user.id === resolvedOwnerId) continue;

  const alreadyGranted = await MeetingAccessGrantRepository.existsForMeetingAndGrantee(meetingId, user.id);
  if (alreadyGranted) continue;

  await MeetingAccessGrantRepository.create({
    id: randomUUID(),
    meetingId,
    ownerId: resolvedOwnerId,
    granteeUserId: user.id,
    expiresAt: null,
    revokedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}
```

```typescript
// packages/shared/src/domain/meetingStatus.ts — diffs only
export type MeetingStatus =
  | "pending" | "joining" | "waiting_admission" | "recording" | "transcribing" | "summarizing"
  | "completed" | "admission_timeout" | "rejected" | "error"
  | "transcription_error"; // NEW

const ALLOWED_TRANSITIONS: Record<MeetingStatus, ReadonlyArray<MeetingStatus>> = {
  // ...existing entries unchanged...
  transcription_error: ["transcribing", "summarizing", "completed"], // NEW — recoverable, not terminal
};

// ACTIVE_PROCESSING_STATUSES: UNCHANGED — transcription_error is deliberately excluded.

const MEETING_STATUS_LABELS_ES: Record<MeetingStatus, string> = {
  // ...existing entries unchanged...
  transcription_error: "Error de transcripción", // NEW
};
```

```typescript
// apps/web/src/components/MeetingDetailsView.tsx — exact diffs
// ~116
const canReprocess =
  (meeting.status === "completed" || meeting.status === "transcription_error") &&
  meeting.recordingFilePath &&
  (!meeting.rawTranscription || !meeting.summary);

// ~118-133
const handleReprocess = async () => {
  const priorStatus = meeting.status; // NEW — captured before the optimistic set below
  setIsReprocessing(true);
  setMeeting((m) => ({ ...m, status: "transcribing" }));
  try {
    const result = await reprocessMeetingAction(meeting.id);
    if (!result.success) {
      alert("Error al reprocesar: " + result.error);
      setMeeting((m) => ({ ...m, status: priorStatus })); // was hardcoded "completed"
    }
  } catch (err) {
    console.error(err);
    setMeeting((m) => ({ ...m, status: priorStatus })); // was hardcoded "completed"
  } finally {
    setIsReprocessing(false);
  }
};

// ~656 (MP4 download)
{meeting.recordingFilePath && ( /* was: meeting.status === "completed" && meeting.recordingFilePath */
  <a href={meeting.recordingFilePath} ...>MP4</a>
)}

// ~703 (video player)
{meeting.recordingFilePath && ( /* was: meeting.status === "completed" && meeting.recordingFilePath */
  <Card className="overflow-hidden"> ... </Card>
)}

// ~641 retry-rejected/error button — UNCHANGED, condition already excludes transcription_error
// (meeting.status === "rejected" || meeting.status === "error") stays exactly as-is.
```

```typescript
// apps/web/src/components/DashboardClient.tsx — exact diffs
function getStatusVariant(status: MeetingStatus) {
  switch (status) {
    case "completed": return "success";
    case "error": return "destructive";
    case "rejected": return "destructive";
    case "transcription_error": return "warning"; // NEW
    case "recording":
    case "transcribing":
    case "summarizing": return "warning";
    default: return "secondary";
  }
}

// filter predicate (~85-89), "error" tab folds transcription_error in:
(statusFilter === "error" && (m.status === "error" || m.status === "transcription_error")) ||
```

## Schema (Drizzle)

```typescript
export const meetingStatusEnum = pgEnum("meeting_status", [
  "pending", "joining", "waiting_admission", "recording", "transcribing", "summarizing",
  "completed", "admission_timeout", "error", "transcription_error", "rejected",
]);

export const meetings = pgTable("meetings", {
  // ...existing columns unchanged...
}, (table) => [
  index("meetings_source_event_unique_idx")
    .on(table.sourceProvider, table.sourceEventId)
    .where(sql`${table.sourceEventId} IS NOT NULL`), // drizzle-kit emits this as a partial UNIQUE index
]).enableRLS();
```

Note: `pgTable`'s callback-array form is how this schema already expresses per-table index/constraint
builders (unique + partial). If drizzle-kit's generated DDL for a partial *unique* index differs from a
hand-written `CREATE UNIQUE INDEX ... WHERE ...`, the hand-written SQL in `0007` is the source of truth —
`schema.ts` only needs to describe the same constraint so future `drizzle-kit generate` diffs don't
re-propose it.

### Migration SQL

```sql
-- drizzle/0007_meeting_dedup_index.sql
CREATE UNIQUE INDEX "meetings_source_event_unique_idx" ON "meetings" ("source_provider", "source_event_id")
WHERE "source_event_id" IS NOT NULL;
```

```sql
-- drizzle/0008_transcription_error_status.sql
ALTER TYPE "public"."meeting_status" ADD VALUE IF NOT EXISTS 'transcription_error';
```

## Testing Strategy (TDD — RED test required for every logic item below; UI/multimedia exempt per AGENTS.md)

| Layer | What to test | RED test location | DB requirement |
|---|---|---|---|
| Dedup race on `queueMeetingRun` | Two concurrent calls for the same `(sourceProvider, sourceEventId)` insert exactly one row; loser returns winner's `{ id, ownerId }` | Extend `apps/__tests__/shared/services/meeting-queue-service.test.ts` — NEW `describe.skipIf(!dbAvailable)` block using `createLiveConnection` (mirrors `meeting-access-grant-repository.test.ts`) | **Live Postgres** — a mocked `MeetingRepository` cannot exercise a real unique-index race; this is the exact scenario the spec calls out |
| Manually-enqueued meetings exempt from the index | Two null-`sourceEventId` inserts both persist | Same new live-DB block | Live Postgres |
| `insertDedupedBySourceEvent` conflict → refetch path | Given a pre-existing row, calling it again returns that row without a second insert | Same new live-DB block (single scenario covers both the repository method and the service) | Live Postgres |
| `queueMeetingRun` non-source-event branches unaffected | Existing 3 mocked tests keep passing with widened `{ id, ownerId }` return type | `apps/__tests__/shared/services/meeting-queue-service.test.ts` (existing mocked `describe`) — extend assertions to also check `result.ownerId` | Mocked (unchanged pattern) |
| `existsForMeetingAndGrantee` idempotency | No row → `false`; any row (even `revokedAt` set) → `true` | Extend `apps/__tests__/shared/repositories/meeting-access-grant-repository.test.ts` — NEW test cases in the existing `describe.skipIf(!dbAvailable)` block | **Live Postgres** — same rationale as the dedup test: this method's whole purpose is "does a row exist regardless of state", best proven against a real table, not a mock that trivially returns what it's told |
| `autoJoinService` co-attendee grant creation | Non-owner registered attendee gets a grant; unregistered attendee and Owner are skipped; repeated poll doesn't duplicate; revoked grant isn't resurrected | Extend `apps/__tests__/worker/shared/auto-join-service.test.ts` — mock `UserRepository`, `MeetingAccessGrantRepository`, and `queueMeetingRun` (now returning `{ id, ownerId }`) | Mocked (matches this file's existing pattern; the idempotency semantics themselves are proven at the repository layer above, not re-derived here) |
| `meetingStatus` union/transitions/label/active-set | `transcription_error` is recoverable (`canTransitionStatus("transcription_error", "completed")` true); NOT in `ACTIVE_PROCESSING_STATUSES`; label is `"Error de transcripción"` | Extend `apps/__tests__/web/shared/meeting-status.test.ts` (the real existing file — NOT the `shared/domain/...` path implied by spec.md, which doesn't exist in this repo) | N/A (pure function) |
| `meetingWorkerService` AI-phase catch | Given upload succeeded, AI phase throws → status `transcription_error`, not `error`; join/record failure (outer catch) still yields `error` | Extend `apps/__tests__/worker/services/meeting-worker-service.test.ts` | Mocked (matches this file's existing pattern) |
| Exempt (UI/multimedia, per AGENTS.md) | `MeetingDetailsView.tsx` gating conditions, `DashboardClient.tsx` badge variant/filter — no test file exists for either component today; adding one is out of scope for this bug-fix change (pre-existing gap, not introduced here) | Manual/integration validation only |

Two tests **require the live-DB pattern** (`createLiveConnection` + `describe.skipIf(!dbAvailable)`), not a
mocked module, per this repo's established precedent and the Bun `mock.module()` first-registration-wins
gotcha that already broke CI once this session:

1. The dedup race test on `queueMeetingRun` (`meeting-queue-service.test.ts`) — a real unique-index
   conflict cannot be simulated by a mock that just returns whatever the test tells it to.
2. The new `existsForMeetingAndGrantee` idempotency test (`meeting-access-grant-repository.test.ts`) — same
   reasoning; the method's contract is entirely about real row state.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or
process-integration boundary introduced by this change. The new auto-grant write is scoped narrowly (see
Non-Goals in spec.md) and reuses 009's existing `meeting_access_grants` write path and RLS posture.

## Migration / Rollout

Two migrations, `drizzle/0007_meeting_dedup_index.sql` and `drizzle/0008_transcription_error_status.sql`,
applied in order. No backfill: pre-existing duplicate `meetings` rows for the same
`(sourceProvider, sourceEventId)` (if any exist in current data) would make `0007` fail to create the
unique index — per this repo's Migration Note precedent (009 also assumed a DB reset alongside its
migration for test data), this is expected to run against a reset/clean dataset. Pre-existing `error` rows
are not retroactively reclassified to `transcription_error` (explicit non-goal in spec.md).

## Review-Workload Forecast

Per this repo's 009 precedent, the changed-lines forecast and chained-PR split (if the 400-line threshold
is crossed) are carried in `tasks.md`, not `plan.md` — 009's `plan.md` does not contain that section;
009's `tasks.md` does. This design intentionally leaves that forecast for the tasks phase to keep the same
convention. A rough scope signal for the tasks-phase forecast: three independently testable problem areas
(dedup, auto-grant, transcription recovery), each touching 2-4 files with small, mechanical diffs (no new
components, no new services) — likely well under the 400-line chained-PR threshold as a single PR, but the
tasks phase should confirm against actual line counts once diffs are written.

## Open Questions

None. The one open item flagged by the spec-writing agent (migration file split for the partial unique
index vs. the additive enum value) is resolved above — two files, matching the `0001` isolation precedent.
