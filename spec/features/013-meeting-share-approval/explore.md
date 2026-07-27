# Exploration: Member-Share Admin Approval (ADR-0008) + SMTP Provider (ADR-0004)

Source ADRs: `docs/adr/0004-smtp-email-provider.md`, `docs/adr/0008-member-share-admin-approval.md`.
Domain vocabulary: `docs/CONTEXT.md` ("Meeting Ownership & Sharing" section — `Owner`, `Access Grant`,
`Participant`, `Auto-Join Co-Attendee Grant`, `Share Request`).

## Current State

**Schema** (`packages/shared/src/db/schema.ts`): `meetings` (L43-80, `ownerId` FK notNull, unique partial
index on `(sourceProvider,sourceEventId)` L76-78 — untouched per ADR-0007). `authorizedAccountRoleEnum =
["admin","member"]` (L17), `authorizedAccounts` (L19-27, platform-wide, no `meetingId`). `shareTypeEnum =
["restricted_email"]` only (L87). `meetingShares` (L97-112): no state column beyond `expiresAt`/`revokedAt`
— no pending/approved/rejected concept exists. `meetingAccessGrants` (L123-144): unconditional unique
index on `(meetingId, granteeUserId)` (L142, ADR-0007's arbiter), no access-type column — `temporary`/
`permanent` map cleanly to `expiresAt`, but nothing distinguishes them today. **Zero existing Share
Request surface anywhere.**

**Sharing service/repos**: `MeetingShareService.createShare` (`apps/web/src/services/meetingShareService.ts:129-196`)
hard-checks `callerId !== meeting.ownerId` → throw (L134-136), no role branch. `revokeShare` (L217-229)
same pattern (L222-227). `renewShareAccess`/`regenerateShareLink` have **no caller check at all**
(L240-288). `MeetingAccessGrantService.requireOwnedMeeting` (`apps/web/src/services/meetingAccessGrantService.ts:23-32`)
is the equivalent gate for grants — same hard owner-only pattern. `MeetingAccessGrantRepository.existsForMeetingAndGrantee`/
`createDedupedForMeetingAndGrantee` (`packages/shared/src/repositories/MeetingAccessGrantRepository.ts:31-76`)
are ADR-0007's idempotency primitives — reusable pattern, but that path stays untouched. `SharingProvider`
interface hardcodes `readonly type: "restricted_email"` (`SharingProvider.ts:21`).

**Email layer**: `EmailProviderFactory.getProvider()` (`EmailProviderFactory.ts:7-22`) switches only on
`"console"`, default also falls back to console with a warning — never crashes on unknown/missing config,
matching ADR-0004's required fallback behavior. Confirmed by grep: exactly **2** literal
`EmailProviderFactory.getProvider().send(` call sites — `meetingShareService.ts:182` and `:280` — plus a
3rd logical send inside `RestrictedEmailSharingProvider.requestAccess` (`providers/RestrictedEmailSharingProvider.ts:38-59`,
constructor-injected via `SharingProviderFactory.ts:28`). No other callers exist anywhere in the repo.
`nodemailer` is in **no** `package.json` (web/worker/extension/shared/root) — only transitively in
`bun.lock`; it would need adding to `apps/web/package.json` only (the sole owner of `integrations/email/**`).
**No `.env*.example` files exist anywhere in this repo** (`**/.env*` glob = 0 matches) — only
`README.md:190` documents `EMAIL_PROVIDER` in a table; that's the only doc surface that actually exists to
sync.

**Admin/role check**: `auth.ts` JWT `jwt` callback (L142-206) re-resolves `token.role` from
`AuthorizedAccountRepository.findAuthorizedAccount` on every request (L160-166); `session` callback
(L208-214) copies it to `session.user.role` (typed in `types/next-auth.d.ts:4-12` as `"admin"|"member"`).
Idiomatic check, already used in `app/api/admin/authorized-accounts/route.ts:12,25`:
`if (session.user.role !== "admin") return 403`. **Not yet used in any server action** —
`app/actions/shares.ts:8-14` and `grants.ts:7-13` only pull `session.user.id` via a local
`requireCallerId()`. `WebMeetingRepository.visibleToUser` (`apps/web/src/repositories/WebMeetingRepository.ts:15-41`)
explicitly documents "no role bypass" for meeting **visibility** — unrelated to sharing authority, must
not be touched/confused.

**Participant/share UI** (`apps/web/src/components/MeetingDetailsView.tsx`, 1129 lines):
`handleCreateShare` (L178-219, manual email), `handleGrantParticipant`/`handleShareWithParticipant`
(L223-279, per-participant-suggestion), `handleRevokeShare`/`handleResendShare`/`handleRenewShare`/
`handleClearInactiveShares` (L281-399). Explicit design comment (L221-222): **"never a bulk 'share with
all' action — the Owner reviews each one on its own"** — so ADR-0008's "share with all participants" mode
is genuinely new UI, not an extension. Render: "Compartir reunión" card (L990-1125) → participant-suggestion
rows (L1006-1050) → manual-email + TTL controls (L1052-1106) → `restrictedShares.map(renderShareRow)`
(L1120, row defined L486+) is the **only** place a rejected/pending Share Request could passively surface
— and only for the `meeting_shares` (unregistered-recipient) path. Registered-recipient grants have **no
persisted list render** in this component at all (`handleGrantParticipant` only flips ephemeral local
state to "done") — a real gap for the design phase.

**Navbar/layout**: no shared Navbar/Header component exists. `(main)/page.tsx:26-60`,
`(main)/settings/page.tsx:19-40`, and `(main)/meeting/[id]/page.tsx:65-77` each hand-roll their own
identical inline `<header>` JSX. A bell+badge touches at least 3 files unless extracted. `UserMenu.tsx`
(open/close-on-outside-click dropdown, L8-21) is the closest structural precedent for a bell-dropdown
component.

**New-page precedent**: `(main)/settings/page.tsx` — server component, `force-dynamic`, server-side fetch
→ client component props. No role-based route guard exists yet (`lib/pageAuthGuard.ts:13-15` only checks
"has any role"), so a future admin-only page needs its own inline `session.user.role !== "admin"` check,
same as `(main)/page.tsx:21`'s `redirect("/login")` pattern.

**Tests**: `apps/__tests__/web/services/meeting-share-service.test.ts` covers createShare/revokeShare
owner-vs-non-owner + public-rejection (L107-169) and verifyRestrictedAccess signed-URL cases (L195-226) —
no coverage for renewShareAccess/regenerateShareLink/resolvePublicShare/requestRestrictedAccess.
`apps/__tests__/web/services/meeting-access-grant-service.test.ts` fully covers create/list/revoke
owner-gating. Both files' "rejects a non-owner caller" assertions will need new admin/member-branch cases.
`admin-authorized-accounts-route.test.ts` is the precedent for testing the 403-on-non-admin pattern. No
test file exists yet for `integrations/email/**` or `integrations/sharing/{SharingProviderFactory,RestrictedEmailSharingProvider}.ts`
directly (only indirect coverage via meeting-share-service's mocks) or for `MeetingShareRepository`.

## Affected Areas

- `packages/shared/src/db/schema.ts` — needs new Share Request state/table/enum and an access-type
  distinction; no such columns exist today.
- `apps/web/src/services/meetingShareService.ts`, `meetingAccessGrantService.ts` — owner-only checks need
  a role-based branch.
- `apps/web/src/integrations/email/**` — new `SmtpEmailProvider`, `apps/web/package.json` (add
  `nodemailer`).
- `apps/web/src/auth.ts` / server actions — admin-check pattern exists in routes only, not actions; new
  helper needed.
- `apps/web/src/components/MeetingDetailsView.tsx` — 3 new recipient-selection modes attach inside the
  existing "Compartir reunión" card; registered-recipient list has no render surface today.
- `apps/web/src/app/(main)/{page,settings/page,meeting/[id]/page}.tsx` — 3 duplicated inline headers, each
  needs the bell.
- `apps/__tests__/web/services/{meeting-share-service,meeting-access-grant-service}.test.ts` — existing
  owner-gate tests need new cases.
- `README.md` (env docs) — only existing sync target; no `.env*.example` files exist in-repo.

## Open Questions for Spec

1. How to model Share Request state without disturbing `meetingShares`'/`meetingAccessGrants`' existing
   revoke/expire semantics.
2. Where the bell/badge and admin-only page actually live given no shared Navbar exists today.
3. How a rejected registered-recipient Share Request passively surfaces given no existing grants-list UI.

## Risks

- Registered-recipient (Access Grant) rejected Share Requests have no existing UI surface to passively
  render into (design gap, not a blocker, but must be decided in spec/design).
- No `.env*.example` files exist in-repo at all, despite AGENTS.md's stated env-sync convention — spec
  should clarify README.md is the only real sync target for now.
- Admin-role check pattern is route-only today; introducing it into server actions/services is new
  plumbing, not a copy-paste.

## Ready for Proposal

Yes — codebase state is fully mapped with file:line citations; `sdd-propose` can proceed.
