# Admin Approval Required for Member-Owned Shares (Share Request)

ADR-0005/spec 009 established that only the meeting's `Owner` may create or revoke a share or `Access
Grant`, with no role bypass — `authorized_accounts.role` was explicitly orthogonal to meeting visibility
and sharing authority. The business now requires oversight on outbound sharing: when the `Owner`'s
`Authorized Account` role is `member`, they may still choose recipients and access type for a meeting, but
the actual `Access Grant`/`meeting_shares` row — and the email that goes with it — is not created until
some `admin` on the platform approves it. We introduce `Share Request` as that pending, approvable
proposal (one row per recipient, mirroring `meeting_shares`' existing one-row-per-recipient shape). An
`Owner` whose role is `admin` is unaffected and keeps sharing directly, exactly as ADR-0005 already
specified. Approval authority is platform-wide: any `admin`, not only one who happens to be a `Participant`
of that specific meeting, may approve or reject any pending `Share Request`. The `Owner`-assignment race
from feature 010/ADR-0007 (`meetings(source_provider, source_event_id)` unique-insert dedup) is
deliberately left untouched — this decision only changes who may finalize a *share*, never who becomes
Owner.

## Status

accepted

## Considered Options

- **Scope approval authority to admins who are `Participant`s of that meeting**: rejected — the business
  requirement was stated as "an admin of the platform," not "an admin who was invited"; scoping it would
  also require inventing a new eligibility check for meetings with zero attending admins, which is exactly
  the case the platform-wide rule already covers for free.
- **Let admins bypass `Owner` entirely and create/revoke shares directly on any meeting, no request/approval
  step**: rejected — loses the audit trail of what a `member` actually proposed versus what an admin
  approved, and gives no record of a rejected proposal.
- **Per-admin read-tracking for the notification bell ("seen by Ana" vs "seen by Beto")**: rejected — the
  bell's unread count is defined as "pending decision," identical for every admin; a rejected/approved
  `Share Request` is resolved for everyone the moment any one admin acts. Individual read-state is a
  cosmetic Slack-style feature with no functional need here.
- **Notify the `member` (email or in-app) when their `Share Request` is rejected, with a reason**: deferred
  — rejection is currently silent; the `member` discovers the outcome passively via the same meeting's
  existing share list. No `member`-facing notification surface exists in the product today, and none was
  requested beyond the admin-side bell.

## Consequences

- Partially reverses ADR-0005's "only the Owner, no exceptions" rule — `meetingShareService.createShare()`
  and `revokeShare()` gain a role-based branch (`admin` Owner → direct; `member` Owner → `Share Request`).
  Any future code auditing "who can touch a share" must check both the `Owner` and the platform's admin
  role, not `Owner` alone.
- New pending-state data (`Share Request`, one per recipient) that resolves into the exact same downstream
  rows ADR-0005 already defined (`Access Grant` for registered recipients, `meeting_shares` for
  unregistered ones) — no new sharing *mechanism*, only a gate in front of the existing two.
- `single_use` access (link dies on the first successful OTP `verifyAccess()`, reusing `revokedAt`) is only
  offered for unregistered recipients — `Access Grant` has no equivalent one-time-access event to revoke
  on, so registered recipients only ever get `temporary` (defaults to 15 days) or `permanent`.
- First in-app notification surface in the product (navbar bell + a dedicated pending-requests page) —
  no prior UI precedent to extend; this is new surface, not a variation of something existing.
- Depends on ADR-0004 (a real `EmailProvider`) to actually notify anyone or deliver an approved share —
  without it, approval still only logs to console like every other email in this codebase does today.
