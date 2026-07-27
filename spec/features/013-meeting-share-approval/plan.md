# Design: Member-Share Admin Approval + Real SMTP Email Provider

## Technical Approach

Introduce `Share Request` as a **new dedicated table** (`meeting_share_requests`) that gates — never
replaces — the two existing downstream mechanisms from 009 (`meeting_access_grants`, `meeting_shares`).
The role branch lives in the server-action layer (route to request vs. direct) with a defense-in-depth
guard inside the services (member direct-create throws). A new `ShareRequestService` owns the
pending → approved | rejected | cancelled lifecycle; approval re-enters the existing
`MeetingAccessGrantService.createGrant` / `MeetingShareService.createShare` paths on behalf of the Owner,
so email sending and dedup (ADR-0007) stay in one place. `SmtpEmailProvider` (Nodemailer) slots into the
existing `EmailProviderFactory` with zero caller changes. The bell forces extraction of the shared header
the 3 pages currently duplicate.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Share Request persistence | New table `meeting_share_requests` (one row per recipient) | Pending-state columns on `meetingShares`/`meetingAccessGrants` | Pending rows in `meetingShares` would require a fake `tokenHash` (NOT NULL) and leak into `listSharesByMeetingId`/`resolvePublicShare`; pending rows in `meetingAccessGrants` would collide with ADR-0007's `(meetingId, granteeUserId)` unique dedup arbiter (a rejected request would block a later real grant). A separate table keeps both tables' revoke/expire semantics untouched and preserves the audit trail ADR-0008 requires (proposed vs. approved, rejections persisted) |
| Recipient modeling in the request | `granteeUserId` (registered) XOR `recipientEmailNormalized` (unregistered), CHECK constraint enforces exactly one | Single free-text email column, resolve at approval time | Resolution at request time is when `single_use` eligibility is decided (unregistered only); resolving later could silently change the request's meaning between proposal and approval |
| Access-type modeling | Enum `share_request_access_type = ["single_use","temporary","permanent"]` + nullable `expiresInDays` (required iff `temporary`); on `meeting_shares`, new `singleUse boolean NOT NULL DEFAULT false` | Encode access type only as `expiresAt` math | `single_use` is orthogonal to expiry (dies on first successful OTP `verifyAccess()`, reusing `revokedAt` per ADR-0008) — needs a persisted flag on the share row itself so `verifyRestrictedAccess` can revoke on first success. Admin Owners also get the 3 access types directly, so the flag belongs to `meeting_shares` independent of requests |
| Duplicate-pending prevention | Two partial unique indexes: `(meetingId, granteeUserId) WHERE status='pending'` and `(meetingId, recipientEmailNormalized) WHERE status='pending'` | App-level check only | Same insert-is-the-arbiter idiom as ADR-0007; race-proof, one request per recipient |
| Where the role branch lives | Actions (`shares.ts`/`grants.ts`) resolve `{ id, role }` once via new shared `requireCaller()` and route member Owners to `ShareRequestService`; services additionally accept optional `callerRole` and throw on member direct-create | Branch only in services (service creates the request internally) | Services keep single responsibilities (create vs. propose); the M2M `API_ROUTE_SECRET` routes (no session) keep passing `callerId: undefined` untouched; the service-level guard still protects non-action callers (chat tool `manage_meeting_share`) from bypassing approval |
| Admin-role check mechanism | Reuse NextAuth `session.user.role` (already re-resolved per request in `auth.ts` jwt callback); new `requireCaller(): Promise<{ id, role }>` in `apps/web/src/lib/sessionCaller.ts` replaces the two duplicated `requireCallerId()` helpers | New middleware / DB lookup per action | The role is already fresh on every request (explore.md, `auth.ts` L142-206); plumbing it is a parameter, not a mechanism |
| Approval executes as the Owner | `approveShareRequest` calls `createGrant`/`createShare` with `callerId = meeting.ownerId` (the requester) | Relax owner checks to accept admin callers | Keeps 009's owner gates byte-identical for the direct path; the approval service is the only sanctioned impersonation point, and the audit lives in `resolvedBy` |
| Member revocation | Member Owner revokes their own shares/grants **directly** (owner gate unchanged); only *creation* goes through Share Request | Literal reading of ADR-0008 ("revokeShare gains the branch") = revoke also needs approval | The Share Request lifecycle models share *proposals* only (approval creates a row; rejection creates nothing — no revoke semantics exist in ADR-0008's own model), and blocking a member from containing an accidental share is a security anti-feature. This narrows ADR-0008's one sentence; flagged in Risks |
| Rejected-request passive surface (registered path) | New "Solicitudes y accesos" section inside the existing "Compartir reunión" card: renders this meeting's Share Requests (all statuses, both paths) via `listShareRequestsByMeetingIdAction`, plus a minimal Access Grants list via existing `listGrantsAction`, mirroring `restrictedShares.map(renderShareRow)` | Separate page; toast/notification | Closes the explore.md gap (grants had no render surface) in the one place the Owner already looks; passive discovery per proposal non-goals |
| Bell placement | Extract shared `AppHeader` server component used by the 3 pages; bell (`PendingRequestsBell`, client, modeled on `UserMenu.tsx`) rendered inside it, admin-only, badge = `countPending()` fetched server-side per render, links to the admin page | Bolt the bell into each of the 3 hand-rolled headers | 3-way duplication already exists (explore.md); adding a 4th copy of header JSX per page to avoid a component is backwards. No polling — count refreshes on navigation, matching "unread = pending" semantics |
| Admin page route + guard | `apps/web/src/app/(main)/admin/share-requests/page.tsx`, `force-dynamic` server component (settings-page precedent): no session → `redirect("/login")`; `session.user.role !== "admin"` → `redirect("/")` | Extend `pageAuthGuard.ts` with generic role support | Only one admin page exists; inline check matches the existing `admin/authorized-accounts/route.ts` idiom. Generalize when a second admin page appears |
| SMTP fallback location | Inside `SmtpEmailProvider.send()`: config complete → nodemailer send; incomplete + `NODE_ENV === "production"` → throw (blocks the send); incomplete otherwise → log warning + console-provider behavior | Env check in `EmailProviderFactory` | Factory stays a pure name switch (its current contract, explore.md); the provider owns its own operability per ADR-0004's explicit "prod-aware check inside the provider" |
| Bulk "share with all" | UI loops the single-recipient action per `Participant` | Server-side batch action | One request per recipient is the contract; the existing card already works per-recipient (explore.md L221-222), reuse the pattern |

## Data Flow

    Owner clicks share (any of 3 modes, per recipient)
      └─ action resolves requireCaller() → { id, role }
          ├─ role=admin  → MeetingAccessGrantService.createGrant / MeetingShareService.createShare
          │                 (direct, unchanged from 009 + singleUse/accessType mapping)
          └─ role=member → ShareRequestService.createShareRequest → meeting_share_requests (pending)

    Admin bell (AppHeader, role=admin) ── countPending() ──→ /admin/share-requests
      └─ approve → ShareRequestService.approveShareRequest (role=admin required)
      │             ├─ registered  → createGrant(callerId = requesterId)   [temporary/permanent]
      │             └─ unregistered→ createShare(callerId = requesterId)   [+ singleUse] → SMTP email
      │             └─ status=approved, resolvedBy/At, resolvedGrantId|resolvedShareId
      └─ reject  → status=rejected (creates nothing)
    Member cancel (pending only, requester only) → status=cancelled

    Owner reopens meeting card → listShareRequestsByMeetingId + listGrants → passive discovery

    EmailProviderFactory("smtp") → SmtpEmailProvider.send
      ├─ config OK → nodemailer transport (SMTP_HOST/PORT/USER/PASS/FROM)
      ├─ config missing + production → throw (send blocked, loud)
      └─ config missing + dev/local  → console fallback

## Schema (Drizzle)

```typescript
export const shareRequestStatusEnum = pgEnum("share_request_status",
  ["pending", "approved", "rejected", "cancelled"]);
export const shareRequestAccessTypeEnum = pgEnum("share_request_access_type",
  ["single_use", "temporary", "permanent"]);

export const meetingShareRequests = pgTable("meeting_share_requests", {
  id: text("id").primaryKey(),
  meetingId: text("meeting_id").notNull(),
  requesterId: text("requester_id").notNull(),          // == meeting.ownerId at creation
  granteeUserId: text("grantee_user_id"),               // registered recipient (XOR next two)
  recipientEmail: text("recipient_email"),
  recipientEmailNormalized: text("recipient_email_normalized"),
  accessType: shareRequestAccessTypeEnum("access_type").notNull(),
  expiresInDays: integer("expires_in_days"),            // required iff accessType = temporary
  status: shareRequestStatusEnum("status").notNull().default("pending"),
  resolvedBy: text("resolved_by"),                      // admin users.id
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedGrantId: text("resolved_grant_id"),
  resolvedShareId: text("resolved_share_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
}, (t) => [
  uniqueIndex("msr_pending_grantee_uq").on(t.meetingId, t.granteeUserId)
    .where(sql`status = 'pending' AND grantee_user_id IS NOT NULL`),
  uniqueIndex("msr_pending_email_uq").on(t.meetingId, t.recipientEmailNormalized)
    .where(sql`status = 'pending' AND recipient_email_normalized IS NOT NULL`),
]).enableRLS();

// meetingShares gains:
singleUse: boolean("single_use").notNull().default(false),
```

Migration: next sequential `drizzle/NNNN_meeting_share_requests.sql` (2 enums, table + CHECK
`(grantee_user_id IS NOT NULL) <> (recipient_email_normalized IS NOT NULL)`, partial unique indexes,
`meeting_shares.single_use` with default — additive, no backfill needed).

## Interfaces / Contracts

```typescript
// apps/web/src/lib/sessionCaller.ts
export interface SessionCaller { id: string; role: "admin" | "member" }
export async function requireCaller(): Promise<SessionCaller>; // throws "Unauthorized"

// apps/web/src/services/shareRequestService.ts
export interface CreateShareRequestInput {
  callerId: string;                       // must equal meeting.ownerId
  meetingId: string;
  recipient: { granteeUserId: string } | { email: string };
  accessType: "single_use" | "temporary" | "permanent";
  expiresInDays?: number;                 // temporary only; UI pre-fills 15
}
export class ShareRequestService {
  static async createShareRequest(input: CreateShareRequestInput): Promise<ShareRequestRecord>;
  //  - throws if single_use + registered recipient, if non-owner, if duplicate pending
  static async cancelShareRequest(callerId: string, requestId: string): Promise<void>;   // requester + pending only
  static async approveShareRequest(caller: SessionCaller, requestId: string): Promise<void>; // admin only, pending only
  static async rejectShareRequest(caller: SessionCaller, requestId: string): Promise<void>;  // admin only, pending only
  static async listPending(): Promise<ShareRequestListItem[]>;       // admin page
  static async countPending(): Promise<number>;                      // bell badge
  static async listByMeetingId(callerId: string, meetingId: string): Promise<ShareRequestRecord[]>; // owner card
}

// Existing services — additive param, existing callers unaffected:
MeetingShareService.createShare(input, callerId?, callerRole?)   // member role → throw
MeetingAccessGrantService.createGrant({ ...input, callerRole? }) // member role → throw
// CreateShareInput gains singleUse?: boolean; verifyRestrictedAccess revokes on first
// successful verify when share.singleUse (reuses revokedAt, ADR-0008).
// createGrant maps: permanent → noExpiry, temporary → ttlMinutes = expiresInDays * 1440.

// apps/web/src/integrations/email/providers/SmtpEmailProvider.ts
export class SmtpEmailProvider implements EmailProvider {
  constructor(transportFactory?: () => Transporter); // injectable for tests
  async send(input: SendEmailInput): Promise<void>;  // prod+missing config → throw
}
// EmailProviderFactory: case "smtp" → new SmtpEmailProvider(). Env: SMTP_HOST, SMTP_PORT,
// SMTP_USER, SMTP_PASS, SMTP_FROM, EMAIL_PROVIDER=smtp — documented in README.md env table
// (only real sync target; no .env*.example files exist in-repo, per explore.md).
```

## File Changes

| File | Action | Description |
|---|---|---|
| `packages/shared/src/db/schema.ts` | Modify | 2 new enums, `meetingShareRequests`, `meetingShares.singleUse` |
| `drizzle/NNNN_meeting_share_requests.sql` | Create | Migration above |
| `packages/shared/src/repositories/MeetingShareRequestRepository.ts` | Create | `create`, `findById`, `listPending`, `countPending`, `listByMeetingId`, `resolve(id, {status, resolvedBy, resolvedGrantId?, resolvedShareId?})`, `cancel` — mirrors `MeetingAccessGrantRepository` |
| `apps/web/src/lib/sessionCaller.ts` | Create | `requireCaller()` — replaces both duplicated `requireCallerId()` helpers |
| `apps/web/src/services/shareRequestService.ts` | Create | Lifecycle service (contract above) |
| `apps/web/src/app/actions/shareRequests.ts` | Create | `createShareRequestAction`, `cancelShareRequestAction`, `approveShareRequestAction`, `rejectShareRequestAction`, `listShareRequestsByMeetingIdAction`, `listPendingShareRequestsAction` |
| `apps/web/src/app/actions/shares.ts`, `grants.ts` | Modify | Use `requireCaller()`; member Owner → route create to `ShareRequestService`; admin → direct (revoke stays direct for both roles) |
| `apps/web/src/services/meetingShareService.ts` | Modify | `callerRole` guard; `singleUse` persist + revoke-on-first-verify in `verifyRestrictedAccess` |
| `apps/web/src/services/meetingAccessGrantService.ts` | Modify | `callerRole` guard; accessType→TTL mapping |
| `apps/web/src/integrations/sharing/types.ts` | Modify | `CreateShareInput.singleUse?: boolean` |
| `apps/web/src/integrations/email/providers/SmtpEmailProvider.ts` | Create | Nodemailer provider, prod-aware fallback |
| `apps/web/src/integrations/email/EmailProviderFactory.ts` | Modify | Add `"smtp"` case |
| `apps/web/package.json` | Modify | Add `nodemailer` (+ `@types/nodemailer` dev) |
| `apps/web/src/components/AppHeader.tsx` | Create | Shared header extracted from the 3 duplicated inline `<header>`s |
| `apps/web/src/components/PendingRequestsBell.tsx` | Create | Client dropdown/badge, modeled on `UserMenu.tsx`; admin-only; links to admin page |
| `apps/web/src/app/(main)/{page,settings/page,meeting/[id]/page}.tsx` | Modify | Swap inline headers for `AppHeader`; meeting page also fetches grants + share requests into props |
| `apps/web/src/app/(main)/admin/share-requests/page.tsx` | Create | `force-dynamic`, login+role guard, lists pending with approve/reject |
| `apps/web/src/components/AdminShareRequestsView.tsx` | Create | Client view for the admin page |
| `apps/web/src/components/MeetingDetailsView.tsx` | Modify | 3 recipient modes ("todos los Participantes" is new UI), access-type + days controls, member pending/cancel states, new "Solicitudes y accesos" section (requests all-statuses + grants list) |
| `apps/web/src/integrations/chat/tools/definitions.ts` | Modify | `manage_meeting_share` passes caller role; member gets "requires admin approval" error |
| `README.md` | Modify | SMTP env vars + `EMAIL_PROVIDER=smtp` row in the env table |

## Testing Strategy (TDD — RED first; UI-visual exempt per AGENTS.md)

| Unit | Cases | Test file (`apps/__tests__/` mirror) |
|---|---|---|
| `ShareRequestService` | member-owner creates pending; non-owner rejected; `single_use`+registered rejected; `temporary` requires days; duplicate-pending rejected; cancel: requester+pending only; approve: admin-only, creates grant (registered) / share+email (unregistered, `singleUse` honored), stamps resolved fields, as-proposed (no edits); reject: admin-only, creates nothing; non-pending approve/reject/cancel rejected | `web/services/share-request-service.test.ts` (new) |
| `MeetingShareRequestRepository` | pending partial-unique arbiter (both recipient kinds); countPending; resolve/cancel transitions | `shared/repositories/meeting-share-request-repository.test.ts` (new) |
| `MeetingShareService` role branch + singleUse | existing owner-gate cases (L107-169) gain: `callerRole:"member"` direct create throws, `"admin"` passes, undefined role (M2M) unchanged; `verifyRestrictedAccess` revokes single-use share on first success, second verify → `not_found` | `web/services/meeting-share-service.test.ts` (extend) |
| `MeetingAccessGrantService` role branch + accessType | member direct create throws; admin passes; permanent→null expiry; temporary days→expiresAt | `web/services/meeting-access-grant-service.test.ts` (extend) |
| `SmtpEmailProvider` + factory | factory returns smtp provider; missing config: dev → console fallback, `NODE_ENV=production` → throws and does not send; complete config → transport called with to/subject/text/html/from (injected fake transport) | `web/integrations/smtp-email-provider.test.ts` (new — first test for `integrations/email/**`) |
| `requireCaller` | no session → throw; returns `{id, role}` | `web/lib/session-caller.test.ts` (new) |
| Admin gate on actions | approve/reject as member → error (403 idiom precedent: `admin-authorized-accounts-route.test.ts`) | covered in `share-request-service.test.ts` via role param |
| Exempt | `AppHeader`/bell/admin page/`MeetingDetailsView` rendering | manual validation |

## Threat Matrix

N/A — no routing (framework page routes only), shell, subprocess, VCS/PR automation, executable-file
classification, or process-integration boundary.

## Migration / Rollout

Single additive migration (no destructive change, no backfill). SMTP is opt-in via `EMAIL_PROVIDER=smtp`;
reverting to console is env-only. Pending `meeting_share_requests` rows are inert if the code is reverted
(nothing downstream reads them). No feature flag needed.

## Open Questions

None. All six items delegated by the proposal are resolved above (persistence shape, rejected-grant
surface, admin-check plumbing, header extraction + admin route, SMTP structure/env, test plan).

## Risks

- Member-revoke-stays-direct narrows ADR-0008's literal "revokeShare gains the branch" sentence
  (rationale in Decisions). If the business truly wants approval-gated revocation, it needs a new
  request kind — surface this at review.
- `approveShareRequest` impersonates the Owner (`callerId = requesterId`) when re-entering 009 services;
  the tests must pin that this path is unreachable except via an admin-authenticated approval.
- Requests reference recipients resolved at creation time; a user registered *after* an email-recipient
  request was created still gets the `meeting_shares` path on approval (accepted — as-proposed rule).
