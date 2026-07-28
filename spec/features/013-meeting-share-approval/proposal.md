# Proposal: Member-Share Admin Approval + Real SMTP Email Provider

Source ADRs: `docs/adr/0004-smtp-email-provider.md`, `docs/adr/0008-member-share-admin-approval.md`.
Ground truth for current state: `spec/features/013-meeting-share-approval/explore.md` (cited below as
`explore.md`). Vocabulary is canonical per `docs/CONTEXT.md` ("Meeting Ownership & Sharing"): `Owner`,
`Access Grant`, `Participant`, `Auto-Join Co-Attendee Grant`, `Share Request`.

## Intent

Two accepted ADRs, one delivery:

- **Email gap (ADR-0004)**: since feature 009, every "sent" email is a console log —
  `ConsoleEmailProvider` is the only implementation. Share links and OTP codes never reach an inbox; the
  Owner copies links by hand. This blocks the existing `restricted_email` flow AND any approval flow from
  notifying anyone.
- **Oversight gap (ADR-0008)**: the business now requires that a `member`-role Owner cannot finalize
  outbound sharing alone. They propose; a platform `admin` approves or rejects. This **partially reverses
  ADR-0005 decision #5** ("only the Owner, no exceptions"): sharing authority now branches on
  `authorized_accounts.role`. An `admin` Owner keeps sharing directly, unchanged.

## Scope

### In Scope
- **Recipient-selection modes (3)**: share with all `Participant`s / choose among `Participant`s / add an
  email not in the meeting. "Share with all" is genuinely new UI — the current card is deliberately
  per-recipient (`MeetingDetailsView.tsx:221-222`, per explore.md).
- **Access types (3)**: `single_use` (unregistered recipients only; dies on first successful OTP
  `verifyAccess()`), `temporary` (member picks the day count freely at request time, 15 pre-filled as
  default — not fixed), `permanent` (default for `Participant`s). Registered recipients never get
  `single_use` — `Access Grant` has no one-time-access event.
- **`Share Request` lifecycle**: pending → approved | rejected | cancelled. One request per recipient,
  never bundled. The `member` who created a pending request may cancel it themselves. Approval creates the
  exact downstream row ADR-0005 defined (`Access Grant` or `meeting_shares`) and triggers the real email;
  rejection creates nothing.
- **Platform-wide approval authority**: any `admin`, regardless of meeting attendance. Admins approve or
  reject a `Share Request` exactly as the member proposed it (recipient, access type, day count) — admins
  do not edit a pending request's contents.
- **Admin notification surface**: navbar bell + dedicated pending-requests page. Unread count = global
  pending-request count; no per-admin read-tracking.
- **`SmtpEmailProvider`** (Nodemailer) via the existing `EmailProviderFactory`. Console fallback on
  missing config in local/dev; **production fails loudly and blocks the send** on missing SMTP config —
  never a silent console-only "email" once deployed. Both this feature and the pre-existing
  `restricted_email` flow depend on it.

### Out of Scope (deliberately rejected during grill — do not reintroduce)
- Any change to the `Owner`-assignment race/dedup from feature 010/ADR-0007 (`meetings(source_provider,
  source_event_id)` unique insert) — untouched.
- Per-admin notification read-state ("seen by X") — unread = pending, same for every admin.
- Active/pushed rejection notice to the `member` — passive discovery only, via the existing share list.
- Editing/resubmitting a rejected `Share Request` — the member creates a fresh one.
- Admin editing a pending `Share Request`'s contents before approving — approve/reject as-proposed only.
- `single_use` access for registered recipients.
- Email template authoring beyond populating existing `SendEmailInput.text`/`html`.

## Capabilities (contract for sdd-spec)

### New
- `share-request-approval`: Share Request lifecycle, member/admin branch, platform-wide approval.
- `admin-notifications`: bell + pending-requests page, global pending count.
- `smtp-email-delivery`: real SMTP provider behind the existing `EmailProvider` contract.

### Modified
- `meeting-sharing` (009 behavior): createShare/revokeShare and grant creation gain the role branch;
  ADR-0005's owner-only rule is superseded for `member` Owners.

## Approach (high level — full design is sdd-design's job)

- **Email**: new `SmtpEmailProvider implements EmailProvider`, selected by `EMAIL_PROVIDER` in
  `EmailProviderFactory` (reuse the factory; no caller changes — exactly 2 literal + 1 injected call
  sites per explore.md). Add `nodemailer` to `apps/web/package.json` only. Env docs: `README.md` is the
  only real sync target (no `.env*.example` files exist in-repo, per explore.md).
- **Role branch**: extend the existing owner-check pattern in `meetingShareService.ts` /
  `meetingAccessGrantService.ts` with the already-idiomatic `session.user.role !== "admin"` check
  (currently route-only, `admin/authorized-accounts/route.ts` — new plumbing into actions/services, not
  copy-paste). No new admin-check mechanism.
- **Persistence**: `Share Request` needs new persisted pending state — neither `meetingShares` nor
  `meetingAccessGrants` has a pending/approved/rejected column today. Exact schema shape (new table vs.
  columns, access-type modeling) is sdd-design's decision.
- **UI**: three modes attach inside the existing "Compartir reunión" card; the bell needs a small shared
  nav component — none exists today, 3 pages hand-roll duplicate headers (explore.md).
- **TDD (strict, per AGENTS.md)**: every service/role-check/state-transition change starts red in
  `apps/__tests__/` mirror paths; existing owner-gate tests in
  `meeting-share-service.test.ts` / `meeting-access-grant-service.test.ts` gain admin/member-branch cases.

## Open Question (flagged, NOT resolved here)

- Rejected `Share Request`s for **registered** recipients (Access Grant path) have no existing UI surface
  to passively render into — `MeetingDetailsView.tsx` persists no grants list (explore.md L57-59).
  `sdd-design` must decide where passive discovery lives for that path.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Role branch weakens 009's owner gate (security regression) | Med | TDD-first on both branches; keep `WebMeetingRepository.visibleToUser` (visibility) untouched — sharing authority only |
| SMTP misconfig breaks existing `restricted_email` flow | Low | Console fallback on missing config outside production (ADR-0004 requirement) |
| Scope creep into notification/read-state features | Med | Non-goals listed above are contract, not suggestion |

## Rollback Plan

- Feature branch → PR(s); revert the merge commit(s) restores owner-only behavior. Pending `Share
  Request` rows are inert without the approval code path (they gate creation; nothing downstream reads
  them). SMTP reverts to console provider via `EMAIL_PROVIDER` env alone — no code revert needed.

## Success Criteria

- [ ] A `member` Owner's share attempt creates a pending `Share Request` (one per recipient); an `admin`
  Owner shares directly, unchanged.
- [ ] Any platform admin can approve/reject; approval creates the correct grant/share row and sends a
  real email; rejection creates nothing.
- [ ] Bell badge equals the global pending count; dedicated admin page lists pending requests.
- [ ] `single_use` offered only for unregistered recipients; `temporary` defaults to 15 days but the
  member can set any day count; `permanent` default for participants.
- [ ] A `member` can cancel their own pending `Share Request`; admins approve/reject as-proposed, no
  editing.
- [ ] With SMTP env configured, `restricted_email` shares and OTP codes arrive by real email. In
  local/dev, missing config falls back to console. In production, missing config fails loudly and blocks
  the send — never a silent console-only "email" once deployed.
- [ ] All new logic test-first; existing suites green (`bun test apps/__tests__`).
