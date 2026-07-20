# Design: Meeting Ownership & Personalized Sharing (+ S3 Naming)

## Technical Approach

Add a single ownership choke point (`meetings.ownerId`, `NOT NULL` FK to `users.id`) resolved at the
one function every meeting-creation path already funnels through — `queueMeetingRun()` — instead of
patching each caller independently. Every read path (`WebMeetingRepository`, `createShareAction`) gains
an explicit ownership/grant filter instead of the current no-filter/no-auth-check behavior. A new
`meeting_access_grants` table (mirrors `meeting_shares`' shape) covers registered-user sharing;
`meeting_shares` keeps `restricted_email` only — `"public"` is removed via enum recreation, not a data
migration, because Postgres cannot drop a live enum value. S3 naming becomes read-persisted-key-first,
recompute-fallback-second, so the new `${provider}/${name}_${date}_${id}.mp4` format never desyncs
already-uploaded objects.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Owner capture point | Single change in `queueMeetingRun()` (packages/shared/src/services/meetingQueueService.ts), new mandatory `ownerId: string` param | Patch each of the 6 entry points independently | Root-cause fix: every entry point already routes through this one function; one guard beats six |
| Chat-tool auth | `getServerSession(authOptions)` called directly inside `enqueueMeetingTool.execute` / `manageMeetingShareTool.execute` | Thread a `context: { userId }` param through `ToolDefinition.execute` → `executeTool` → `streamChatRuntime` → every `ChatProvider.streamChat` implementation | `api/chat/route.ts` already runs `getServerSession` in the same Next.js request scope; calling it again inside the two tools that need it is a 2-file diff vs. restructuring the entire tool-calling interface for tools that don't need it |
| Machine-to-machine owner (`/api/bot/start`, `API_ROUTE_SECRET`) | Require `ownerEmail` in the request body, resolve via new `UserRepository.findByEmail`; 400 if missing/unresolvable | Leave this route ownerless (violates NOT NULL); derive owner from `organizerEmail` (spec explicitly forbids this) | No session exists on this route; explicit resolvable identity is the only way to satisfy "Owner is mandatory" without inventing calendar-derived ownership. Confirmed via `apps/extension/src/background/api-client.ts` (`resolveTransport`) this route is only hit in legacy-token auth mode — the modern linked-session mode rewrites to `/api/v1/extension/bot/start`, which already has `userId` from the Extension Access Token payload and needs zero changes. `docs/extension.md` confirms `/api/bot/start` predates the Extension Access Token system (002/003/007) — legacy fallback, not a separately-designed integration |
| Auto-join owner resolution | Primary path (OAuth-connected calendar users): thread `ownerId` = the calendar-enabled `users.id` whose credentials the provider queried under. Narrow fallback path (zero OAuth users, static `AUTO_JOIN_ORGANIZER_EMAILS` env list): skip enqueueing, log a warning | Fabricate a synthetic/service owner for the env-var-only fallback | The env-list fallback has no `users` row to attribute — inventing ownership data is worse than a logged skip (non-destructive; meeting just doesn't auto-join), and there's no evidence this narrow config path is relied on in production |
| `"public"` enum removal | Recreate `share_type` enum without `"public"`; revoked `"public"` rows relabeled to `"restricted_email"` before the type swap | Backfill/delete rows; leave enum as-is and just stop issuing `"public"` in code | Postgres has no `ALTER TYPE ... DROP VALUE`; rows already have `revokedAt` set so relabeling is inert (`resolvePublicShare` checks `revokedAt` before ever branching on `shareType`) |
| Grant TTL | Reuse `DEFAULT_SHARE_TTL_OPTIONS_MINUTES` verbatim, extracted to a shared module | New TTL constant for grants | Spec requires identical menu; extraction avoids duplicating the array in two services |
| Participant storage | `meetings.participantEmails: jsonb` (string array), no new table | Full `meeting_participants` table | YAGNI — Owner reviews/grants one at a time, no per-participant state (status, timestamps) needed |
| Calendar owner attribution | `CalendarMeetingEvent` gains `ownerUserId: string`; `GoogleCalendarProvider` already loops per-OAuth-user, just needs to stamp it | Resolve owner later from `organizerEmail` | Spec forbids deriving from `organizerEmail`; the per-user OAuth loop already knows exactly which registered user this event came from |

## Data Flow

    Extension INVITE_BOT ──┐
    Dashboard "queue" ──────┼──→ resolve ownerId (session/token/email) ──→ queueMeetingRun(ownerId, ...)
    Chat enqueue_meeting ───┤                                                        │
    Calendar auto-join ─────┘                                                        ▼
                                                                          MeetingRepository.insert
                                                                          (ownerId NOT NULL)

    listRecent(userId) ──→ WHERE ownerId = :userId
                              OR EXISTS(live grant for :userId)
                              AND owner.authorized_accounts.isActive
                         ──→ MeetingRecord[]

    Owner opens sharing ──→ Participant suggestions (event.attendees, calendar-sourced only)
                         ──→ createGrantAction (registered user) | createShareAction (restricted_email)
                         ──→ both require session.user.id === meeting.ownerId

    Upload completes ──→ buildAndPersistRecordingStorageKey(meeting) ──→ meetings.recordingStorageKey
    Delete/sign/download ──→ recordingStorageKey ?? buildRecordingStorageKey() (legacy fallback)

## File Changes

| File | Action | Description |
|---|---|---|
| `packages/shared/src/db/schema.ts` | Modify | `meetings.ownerId` (NOT NULL FK `users.id`), `meetings.recordingStorageKey` (nullable text), `meetings.participantEmails` (nullable jsonb string[]); `shareTypeEnum` drops `"public"`; new `meetingAccessGrants` table |
| `drizzle/0006_meeting_ownership_and_sharing.sql` | Create | Hand-written migration: add columns, create `meeting_access_grants`, revoke+relabel `"public"` rows, recreate `share_type` enum |
| `packages/shared/src/repositories/UserRepository.ts` | Create | `findByEmail(email): Promise<{id, email} \| null>` — needed by the machine-to-machine owner resolution |
| `packages/shared/src/repositories/MeetingRepository.ts` | Modify | `MeetingInsert` now requires `ownerId`; no method signature changes (types flow from schema) |
| `packages/shared/src/repositories/MeetingAccessGrantRepository.ts` | Create | CRUD mirroring `MeetingShareRepository`: `create`, `findById`, `listByMeetingId`, `findLiveGrant(meetingId, granteeUserId)`, `revokeById` |
| `packages/shared/src/services/meetingQueueService.ts` | Modify | `StartMeetingParams` gains mandatory `ownerId: string` and optional `participantEmails?: string[]`; both passed to `MeetingRepository.insert` |
| `apps/web/src/commands/meeting/EnqueueMeetingCommand.ts` | Modify | `EnqueueMeetingInput` gains mandatory `ownerId: string` |
| `apps/web/src/services/meetingService.ts` | Modify | `enqueueMeeting(input)` — `input.ownerId` required, passthrough only |
| `apps/web/src/app/actions/bot.ts` | Modify | `startBotAction` resolves `getServerSession(authOptions)`, 401s if no `session.user.id`, passes it as `ownerId` |
| `apps/web/src/app/api/v1/extension/bot/start/route.ts` | Modify | `ownerId = auth.payload.userId` (already present in `ExtensionAccessTokenPayload`, zero new auth work) |
| `apps/web/src/app/api/bot/start/route.ts` | Modify | Require `ownerEmail` in body; `UserRepository.findByEmail`; 400 if missing/unknown |
| `apps/worker/src/integrations/calendar/types.ts` | Modify | `CalendarMeetingEvent` gains `ownerUserId: string`, `participantEmails: string[]` |
| `apps/worker/src/integrations/calendar/providers/GoogleCalendarProvider.ts` | Modify | `fetchEvents` takes the current OAuth `user.id`, stamps `ownerUserId`; maps `event.attendees` → `participantEmails` |
| `apps/worker/src/services/autoJoinService.ts` | Modify | Primary path (OAuth-connected users present): passes `ownerId: event.ownerUserId`, `participantEmails: event.participantEmails` to `queueMeetingRun`. Narrow fallback (zero OAuth users, static `AUTO_JOIN_ORGANIZER_EMAILS` env list): no resolvable `users` row exists — skip enqueueing that event and log a warning instead of calling `queueMeetingRun` |
| `apps/web/src/repositories/WebMeetingRepository.ts` | Modify | `listRecent(userId)` / `listFiltered(userId, filters)` — ownership+grant+active-owner filter (see Interfaces) |
| `apps/web/src/repositories/MeetingAccessGrantRepository.ts` callers (`apps/web/src/app/(main)/**` pages) | Modify | Thread `session.user.id` into the repository calls |
| `packages/shared/src/meetingProvider.ts` | Modify | Add `sanitizeMeetingNameForStorageKey(name)` and `buildNamedRecordingStorageKey(meetingId, meetingName, recordedAt, providerHint)`; `buildRecordingStorageKey()` untouched (legacy fallback) |
| `apps/worker/src/services/meetingWorkerService.ts` | Modify | On upload: compute `buildNamedRecordingStorageKey(...)`, persist to `meetings.recordingStorageKey` alongside `recordingFilePath` |
| `apps/worker/src/services/meetingRecoveryService.ts` | Modify | Resolve key via `meeting.recordingStorageKey ?? buildRecordingStorageKey(...)` |
| `apps/web/src/services/meetingShareService.ts` | Modify | Same resolve-then-fallback for signed URLs; `createShare` requires `callerId` and throws unless `callerId === meeting.ownerId`; drop `"public"` branch |
| `apps/web/src/commands/meeting/DeleteMeetingCommand.ts` | Modify | Same resolve-then-fallback before calling storage delete |
| `apps/web/src/app/api/meetings/[id]/route.ts` | Modify | Same resolve-then-fallback |
| `apps/web/src/app/api/v1/extension/meetings/[id]/route.ts` | Modify | Same resolve-then-fallback |
| `apps/web/src/app/(main)/meeting/[id]/page.tsx` | Modify | Same resolve-then-fallback |
| `apps/web/src/integrations/sharing/types.ts` | Modify | `ShareType = "restricted_email"` (drop `"public"`) |
| `apps/web/src/integrations/sharing/SharingProvider.ts` | Modify | `readonly type: "restricted_email"` |
| `apps/web/src/integrations/sharing/SharingProviderFactory.ts` | Modify | Drop `"public"` case |
| `apps/web/src/integrations/sharing/providers/PublicSharingProvider.ts` | Delete | No longer reachable |
| `apps/web/src/integrations/sharing/shareTtl.ts` | Create | Extracted `DEFAULT_SHARE_TTL_OPTIONS_MINUTES`, `getConfiguredTtlOptionsMinutes`, `resolveExpiresAt` — imported by both `meetingShareService.ts` and the new `meetingAccessGrantService.ts` |
| `apps/web/src/services/meetingAccessGrantService.ts` | Create | `createGrant`, `listGrantsByMeetingId`, `revokeGrant` — mirrors `MeetingShareService`, reuses `shareTtl.ts` |
| `apps/web/src/app/actions/grants.ts` | Create | `createGrantAction`, `revokeGrantAction` — mirrors `shares.ts`, both require `session.user.id === meeting.ownerId` |
| `apps/web/src/app/actions/shares.ts` | Modify | `createShareAction` resolves session, passes `callerId` to `MeetingShareService.createShare` |
| `apps/web/src/components/MeetingDetailsView.tsx` | Modify | Remove `"public"` from `shareType` state/options/labels/rendering; add grant-creation UI (per-participant suggestion list + manual email entry) |
| `apps/web/src/integrations/chat/tools/definitions.ts` | Modify | `enqueueMeetingTool.execute`: resolve session, pass `ownerId`; `manageMeetingShareTool`: drop `"public"` from `share_type` enum, route `create`/`revoke` through `MeetingShareService`/new grant service (not raw `MeetingShareRepository.create`) with the same ownership check |

## Interfaces / Contracts

```typescript
// packages/shared/src/services/meetingQueueService.ts
export interface StartMeetingParams {
  meetingUrl: string;
  botName: string;
  duration: number;
  ownerId: string;                 // NEW — mandatory, users.id
  participantEmails?: string[];    // NEW — calendar event.attendees, optional
  providerHint?: string;
  meetingId?: string;
  sourceProvider?: string;
  sourceEventId?: string;
  organizerEmail?: string;
  startsAt?: Date;
  endsAt?: Date;
}
export async function queueMeetingRun(params: StartMeetingParams): Promise<{ id: string }>;
```

```typescript
// packages/shared/src/repositories/MeetingAccessGrantRepository.ts
export type MeetingAccessGrantRecord = typeof meetingAccessGrants.$inferSelect;
export type MeetingAccessGrantInsert = typeof meetingAccessGrants.$inferInsert;

export class MeetingAccessGrantRepository {
  static async create(values: MeetingAccessGrantInsert): Promise<void>;
  static async findById(id: string): Promise<MeetingAccessGrantRecord | null>;
  static async listByMeetingId(meetingId: string): Promise<MeetingAccessGrantRecord[]>;
  static async findLiveGrant(
    meetingId: string,
    granteeUserId: string,
    now?: Date,
  ): Promise<MeetingAccessGrantRecord | null>; // revokedAt IS NULL AND (expiresAt IS NULL OR expiresAt > now)
  static async revokeById(id: string, when?: Date): Promise<void>;
}
```

```typescript
// apps/web/src/repositories/WebMeetingRepository.ts
export class WebMeetingRepository {
  static async listRecent(userId: string): Promise<MeetingRecord[]>;
  static async listFiltered(userId: string, filters: MeetingFilters): Promise<MeetingRecord[]>;
  // WHERE (meetings.ownerId = :userId OR EXISTS (
  //   SELECT 1 FROM meeting_access_grants g
  //   WHERE g.meetingId = meetings.id AND g.granteeUserId = :userId
  //     AND g.revokedAt IS NULL AND (g.expiresAt IS NULL OR g.expiresAt > now())
  // ))
  // AND EXISTS (
  //   SELECT 1 FROM authorized_accounts a JOIN users u ON u.email = a.email
  //   WHERE u.id = meetings.ownerId AND a.isActive = true
  // )
}
```

```typescript
// apps/web/src/services/meetingAccessGrantService.ts (mirrors MeetingShareService's TTL shape)
export interface CreateGrantInput {
  meetingId: string;
  granteeUserId: string;
  callerId: string;       // must equal meeting.ownerId or throw
  ttlMinutes?: number;
  noExpiry?: boolean;
}
export class MeetingAccessGrantService {
  static async createGrant(input: CreateGrantInput): Promise<{ id: string; expiresAt: Date | null }>;
  static async listGrantsByMeetingId(meetingId: string): Promise<MeetingAccessGrantRecord[]>;
  static async revokeGrant(grantId: string, callerId: string): Promise<void>;
}
```

```typescript
// packages/shared/src/meetingProvider.ts — additions, buildRecordingStorageKey() unchanged
export function sanitizeMeetingNameForStorageKey(name: string | null | undefined): string {
  // lowercase, replace anything outside [a-z0-9-_] with "-", collapse repeats, trim, fallback "meeting"
}
export function buildNamedRecordingStorageKey(
  meetingId: string,
  meetingName: string | null | undefined,
  recordedAt: Date,
  meetingUrl: string,
  providerHint?: string,
): string {
  const provider = resolveMeetingProvider(meetingUrl, providerHint);
  const date = recordedAt.toISOString().slice(0, 10); // YYYY-MM-DD
  const safeName = sanitizeMeetingNameForStorageKey(meetingName);
  return `${provider}/${safeName}_${date}_${meetingId}.mp4`;
}
```

```typescript
// apps/web/src/app/api/bot/start/route.ts — machine-to-machine owner resolution
const ownerEmail = typeof body.ownerEmail === "string" ? body.ownerEmail.trim() : "";
if (!ownerEmail) return NextResponse.json({ error: "ownerEmail is required" }, { status: 400 });
const owner = await UserRepository.findByEmail(ownerEmail);
if (!owner) return NextResponse.json({ error: "ownerEmail does not match a registered user" }, { status: 400 });
// owner.id passed as ownerId to MeetingService.enqueueMeeting
```

## Schema (Drizzle)

```typescript
export const meetings = pgTable("meetings", {
  // ...existing columns...
  ownerId: text("owner_id").notNull().references(() => users.id),
  recordingStorageKey: text("recording_storage_key"),
  participantEmails: jsonb("participant_emails").$type<string[]>(),
}).enableRLS();

export const shareTypeEnum = pgEnum("share_type", ["restricted_email"]);

export const meetingAccessGrants = pgTable("meeting_access_grants", {
  id: text("id").primaryKey(),
  meetingId: text("meeting_id").notNull(),
  ownerId: text("owner_id").notNull(),
  granteeUserId: text("grantee_user_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}).enableRLS();
```

### Migration mechanism for dropping `"public"` (Postgres cannot `ALTER TYPE ... DROP VALUE`)

```sql
-- 1. Revoke existing "public" shares (spec requirement)
UPDATE meeting_shares SET revoked_at = COALESCE(revoked_at, now()), updated_at = now()
WHERE share_type = 'public';

-- 2. Relabel them to a value that survives the new enum. Safe because resolvePublicShare()
--    checks revokedAt before ever branching on shareType — a revoked row's shareType is inert.
UPDATE meeting_shares SET share_type = 'restricted_email' WHERE share_type = 'public'::share_type;

-- 3. Recreate the enum without "public" and repoint the column
ALTER TYPE "share_type" RENAME TO "share_type_old";
CREATE TYPE "share_type" AS ENUM('restricted_email');
ALTER TABLE "meeting_shares" ALTER COLUMN "share_type" TYPE "share_type" USING "share_type"::text::"share_type";
DROP TYPE "share_type_old";

-- 4. New columns / table (see schema section above for full DDL)
ALTER TABLE "meetings" ADD COLUMN "owner_id" text NOT NULL REFERENCES "users"("id");
ALTER TABLE "meetings" ADD COLUMN "recording_storage_key" text;
ALTER TABLE "meetings" ADD COLUMN "participant_emails" jsonb;
CREATE TABLE "meeting_access_grants" ( ... );
```

Per the spec's Migration Note, this repo applies a DB reset alongside the migration (existing rows are
test data), so step 4's `NOT NULL` needs no backward-compat path and steps 1–3 are effectively a no-op
here — they are written for correctness against any future non-test dataset.

## Testing Strategy (TDD — RED test required for every logic item below; UI/multimedia exempt per AGENTS.md)

| Layer | What to test | RED test location |
|---|---|---|
| `queueMeetingRun` requires `ownerId` | Throws/rejects insert without it; passes `ownerId`/`participantEmails` through | `apps/__tests__/shared/services/meeting-queue-service.test.ts` |
| `WebMeetingRepository.listRecent`/`listFiltered` scoping | Owner sees own; grantee sees granted (live only); denies expired/revoked; denies deactivated-owner meetings; no admin bypass | `apps/__tests__/web/repositories/web-meeting-repository.test.ts` |
| `MeetingAccessGrantRepository` | create/list/findLiveGrant expiry+revocation semantics | `apps/__tests__/shared/repositories/meeting-access-grant-repository.test.ts` |
| `MeetingAccessGrantService.createGrant`/`revokeGrant` ownership check | Non-owner rejected; owner succeeds; TTL menu reused | `apps/__tests__/web/services/meeting-access-grant-service.test.ts` |
| `MeetingShareService.createShare` ownership retrofit | Non-owner rejected; owner succeeds; `"public"` shareType rejected | `apps/__tests__/web/services/meeting-share-service.test.ts` |
| `sanitizeMeetingNameForStorageKey` / `buildNamedRecordingStorageKey` | Sanitization edge cases (unicode, slashes, empty name); date format; collision-safe suffix | `apps/__tests__/shared/meeting-provider.test.ts` |
| Storage-key resolve-then-fallback (each of the 7 retrofit call sites) | Uses `recordingStorageKey` when present; falls back to `buildRecordingStorageKey()` when null | Extend each call site's existing test file under `apps/__tests__/{web,worker}/...` |
| `GoogleCalendarProvider` attendee/owner capture | `ownerUserId` stamped per OAuth user; `event.attendees` mapped to `participantEmails`; service-account fallback path yields no `ownerUserId` and is skipped | `apps/__tests__/worker/calendar/google-calendar-provider.test.ts` |
| `autoJoinService` skip-when-ownerless | Events without `ownerUserId` are not enqueued | Extend `apps/__tests__/worker/shared/auto-join-service.test.ts` |
| `/api/bot/start` ownerEmail resolution | 400 when missing/unknown; enqueues with resolved `ownerId` | `apps/__tests__/web/api/bot-start.test.ts` |
| Chat tools ownership | `enqueue_meeting` sets `ownerId` from session; `manage_meeting_share` rejects non-owner create/revoke, rejects `"public"` | `apps/__tests__/web/integrations/chat-tools-definitions.test.ts` |
| Exempt (UI/multimedia, per AGENTS.md) | `MeetingDetailsView.tsx` UI removal/addition; FFmpeg/S3 upload calls themselves | Manual/integration validation only |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or
process-integration boundary introduced by this change.

## Migration / Rollout

Single migration `drizzle/0006_meeting_ownership_and_sharing.sql` applied alongside a DB reset (test
data only, per spec's Migration Note) — no phased rollout or feature flag needed. No backfill of
`recordingStorageKey` for pre-existing recordings (explicit non-goal).

## Open Questions

None. Both prior open items are resolved (see Architecture Decisions table):

- `/api/bot/start` requiring `ownerEmail` only affects the legacy-token auth mode of the extension
  (confirmed via `apps/extension/src/background/api-client.ts` `resolveTransport` and
  `docs/extension.md`); the modern linked-session mode already routes through
  `/api/v1/extension/bot/start`, which needs no design changes.
- `autoJoinService`'s narrow env-var-only fallback (zero OAuth-connected users) skips enqueueing with a
  logged warning rather than fabricating ownership; the primary OAuth-connected-users path threads a
  real `ownerId`.
