# 013 · Member-Share Admin Approval + Real SMTP Email Provider

**Status:** spec (proposal confirmed)

## Purpose

Outbound sharing MUST gain oversight: an `Owner` whose `Authorized Account` role is `member` proposes a
**Share Request**; any platform `admin` approves or rejects it, and only approval creates the real
`Access Grant`/`meeting_shares` row and sends a real email. An `Owner` whose role is `admin` shares
directly, unchanged. Independently, email MUST stop being a console log: a real `SmtpEmailProvider`
delivers share links and OTP codes.

Domain vocabulary is fixed by `docs/CONTEXT.md` ("Meeting Ownership & Sharing"): **Owner**, **Access
Grant**, **Participant**, **Auto-Join Co-Attendee Grant**, **Share Request**. This spec uses those exact
terms — no synonyms. Source ADRs: `docs/adr/0004-smtp-email-provider.md`,
`docs/adr/0008-member-share-admin-approval.md`.

## MODIFIED Requirements (supersede feature 009)

### Requirement: Role-branched sharing authority

Only a meeting's `Owner` MAY initiate sharing or revocation for that meeting; role MUST NOT grant a
non-Owner any sharing authority. When the `Owner`'s `authorized_accounts.role` is `admin`, the
`Access Grant` / `meeting_shares` row MUST be created directly, exactly as feature 009 specified. When
it is `member`, the system MUST create a pending `Share Request` instead and MUST NOT create any
downstream row or send any email until an `admin` approves.
(Previously: ADR-0005/009 required Owner-only with no role branch — "only the Owner, no exceptions".)

#### Scenario: Admin Owner shares directly

- GIVEN `Owner` O of meeting M with `role = admin`
- WHEN O shares M with any recipient
- THEN the `Access Grant` (registered) or `meeting_shares` (unregistered) row is created immediately
- AND no `Share Request` is created

#### Scenario: Member Owner always goes through a Share Request

- GIVEN `Owner` O of meeting M with `role = member`
- WHEN O shares M with any recipient, by any recipient-selection mode
- THEN a pending `Share Request` is created and no `Access Grant`/`meeting_shares` row exists yet
- AND no email is sent

#### Scenario: Non-Owner is still rejected regardless of role

- GIVEN authenticated user X who is not the `Owner` of M, with `role = admin` or `member`
- WHEN X attempts to share or revoke on M
- THEN the operation MUST be rejected (an `admin` acts only on an existing `Share Request`)

#### Scenario: Meeting visibility is unaffected

- GIVEN user A with `role = admin` who neither owns M nor holds a live `Access Grant`
- WHEN A lists or opens M
- THEN access MUST still be denied (009's no-role-bypass visibility rule is untouched)

## ADDED Requirements

### Requirement: Recipient-selection modes

The sharing surface MUST offer exactly three recipient-selection modes: (a) all `Participant`s of the
meeting, (b) a chosen subset of `Participant`s, (c) an email address not present in the meeting. Every
mode MUST resolve to one recipient per outbound unit — mode (a) MUST expand into one `Share Request` (or
one direct row, for an `admin` `Owner`) per `Participant`, never a bundled record.

#### Scenario: Share with all participants expands per recipient

- GIVEN meeting M with 3 `Participant`s and a `member` `Owner`
- WHEN the `Owner` selects "all participants" and confirms
- THEN 3 pending `Share Request`s are created, one per recipient

#### Scenario: Subset selection

- GIVEN meeting M with 3 `Participant`s
- WHEN the `Owner` selects 2 of them and confirms
- THEN exactly 2 recipients are processed and the unselected `Participant` gets nothing

#### Scenario: Email not in the meeting

- GIVEN meeting M and an email address that is not a `Participant`
- WHEN the `Owner` enters it and confirms
- THEN it is processed as a single recipient, resolved as registered (`Access Grant`) or unregistered
  (`meeting_shares`) by the same rule feature 009 already applies

### Requirement: Access types and defaults

The system MUST support three access types per recipient: `single_use`, `temporary`, and `permanent`.
`single_use` MUST be offered ONLY for unregistered recipients (`meeting_shares` path) and MUST become
unusable on the first successful OTP `verifyAccess()`. `temporary` MUST let the requesting `Owner` set
any day count, with 15 days pre-filled as the default rather than fixed. `permanent` MUST be the default
access type for `Participant`s.

#### Scenario: single_use dies on first successful verification

- GIVEN a `single_use` share for an unregistered recipient
- WHEN the recipient completes OTP `verifyAccess()` successfully for the first time
- THEN the share becomes unusable for any subsequent access attempt

#### Scenario: single_use is not offered to registered recipients

- GIVEN a recipient email matching a registered `users.email`
- WHEN the access-type options are presented
- THEN `single_use` MUST NOT be selectable, and only `temporary` or `permanent` are available

#### Scenario: temporary day count is editable, not fixed

- GIVEN the `Owner` selects `temporary`
- WHEN the day-count field is presented
- THEN it is pre-filled with 15
- AND the `Owner` MAY change it to any other valid day count, which is the value carried into the request

#### Scenario: permanent is the default for participants

- GIVEN a `Participant` selected as a recipient
- WHEN the access type is not explicitly changed
- THEN the access type used is `permanent`

### Requirement: Share Request lifecycle

A `Share Request` MUST persist exactly one recipient with its proposed access type and day count, and
MUST occupy exactly one of the states `pending`, `approved`, `rejected`, `cancelled`. The only legal
transitions are `pending -> approved`, `pending -> rejected`, and `pending -> cancelled`. Approval MUST
create the downstream row feature 009 already defines (`Access Grant` for registered recipients,
`meeting_shares` for unregistered ones) and MUST trigger the real email. Rejection and cancellation MUST
create nothing. The `member` who created a pending `Share Request` MAY cancel it; nobody else MAY.

#### Scenario: Approval creates the downstream row and emails

- GIVEN a pending `Share Request` for an unregistered recipient with `temporary`, 15 days
- WHEN an `admin` approves it
- THEN the request becomes `approved`, a `meeting_shares` row is created with a 15-day expiry
- AND the recipient receives a real email with the share link

#### Scenario: Rejection creates nothing

- GIVEN a pending `Share Request`
- WHEN an `admin` rejects it
- THEN the request becomes `rejected` and no `Access Grant`/`meeting_shares` row exists
- AND no email is sent to the recipient

#### Scenario: Author cancels their own pending request

- GIVEN a pending `Share Request` created by `member` Owner O
- WHEN O cancels it
- THEN it becomes `cancelled` and no downstream row is created

#### Scenario: A resolved request cannot transition again

- GIVEN a `Share Request` already in `approved`, `rejected`, or `cancelled`
- WHEN any actor attempts to approve, reject, or cancel it
- THEN the operation MUST be rejected and the state MUST NOT change

#### Scenario: Only the author may cancel

- GIVEN a pending `Share Request` created by `member` Owner O
- WHEN another `member` or an `admin` attempts to cancel it
- THEN the operation MUST be rejected

### Requirement: Platform-wide admin approval authority

Any `Authorized Account` with `role = admin` MUST be able to approve or reject ANY pending `Share
Request`, regardless of whether that admin is a `Participant`, `Owner`, or grantee of the meeting.
Admins MUST approve or reject a `Share Request` exactly as proposed — recipient, access type, and day
count MUST NOT be editable by the approver. A non-admin MUST NOT approve or reject.

#### Scenario: Admin with no relationship to the meeting can decide

- GIVEN `admin` A who is not the `Owner`, not a `Participant`, and holds no `Access Grant` on M
- WHEN A approves a pending `Share Request` on M
- THEN the approval succeeds and the downstream row is created as proposed

#### Scenario: Non-admin cannot decide

- GIVEN a `member` (including the request's own author)
- WHEN they attempt to approve or reject a pending `Share Request`
- THEN the operation MUST be rejected

#### Scenario: Decision is as-proposed

- GIVEN a pending `Share Request` for recipient R with `temporary`, 30 days
- WHEN an `admin` approves it
- THEN the created row uses recipient R with a 30-day expiry, unmodified

### Requirement: Silent rejection with passive discovery

Rejection MUST be silent: the system MUST NOT capture or require a rejection reason, and MUST NOT push
any active notification (email or in-app) to the requesting `member`. The `member` MUST be able to
discover the outcome passively: for an unregistered recipient, via the meeting's existing share list; for
a registered recipient, via the new "Solicitudes y accesos" section (`sdd-design`'s resolution — a
`Share Request` list covering all statuses, plus a grants list, both inside the existing "Compartir
reunión" card on `MeetingDetailsView`).

#### Scenario: No active notice to the member

- GIVEN a pending `Share Request` created by `member` O
- WHEN an `admin` rejects it
- THEN no email and no in-app notification is delivered to O
- AND no rejection-reason field is requested or persisted

#### Scenario: Member sees the outcome passively (unregistered recipient)

- GIVEN a rejected `Share Request` for an unregistered recipient on meeting M
- WHEN O reopens M's sharing surface
- THEN the rejected state is visible in the meeting's existing share list without any notification

#### Scenario: Member sees the outcome passively (registered recipient)

- GIVEN a rejected `Share Request` for a registered recipient (`Access Grant` path) on meeting M
- WHEN O reopens M's sharing surface
- THEN the rejected state is visible in the new "Solicitudes y accesos" section (all-statuses request
  list + grants list, per `sdd-design`) without any notification

### Requirement: Admin notification surface

The application MUST expose a navbar notification bell on every authenticated page and a dedicated page
listing pending `Share Request`s, both visible only to `admin` accounts. The bell badge MUST equal the
GLOBAL count of `Share Request`s in state `pending`. The system MUST NOT track per-admin read state — the
count is identical for every admin and decreases for all of them the moment any admin resolves a request.

#### Scenario: Badge equals the global pending count

- GIVEN 4 pending `Share Request`s across any meetings and any authors
- WHEN any `admin` loads an authenticated page
- THEN the bell badge shows 4

#### Scenario: Resolution decrements the count for every admin

- GIVEN 4 pending requests and admins A and B
- WHEN A approves one
- THEN B's badge shows 3 without B having taken any action

#### Scenario: Pending page is admin-only

- GIVEN an authenticated user with `role = member`
- WHEN they load the pending-requests page
- THEN access MUST be denied and the bell MUST NOT be rendered for them

### Requirement: Real SMTP email delivery with environment-split fallback

A `SmtpEmailProvider` implementing the existing `EmailProvider` contract MUST be selectable through the
existing `EmailProviderFactory` via `EMAIL_PROVIDER`, with no changes required at any existing call site.
When SMTP configuration is missing or incomplete: outside production the provider MUST fall back to
console logging so local/dev keeps working; in production it MUST fail loudly AND block the send —
a production send MUST NEVER silently degrade to a console-only "email".

#### Scenario: Configured SMTP delivers real email

- GIVEN complete SMTP configuration and `EMAIL_PROVIDER` selecting SMTP
- WHEN a `restricted_email` share link or an OTP code is sent
- THEN it is delivered over SMTP to the recipient's real inbox

#### Scenario: Missing config in local/dev falls back to console

- GIVEN incomplete SMTP configuration outside production
- WHEN a send is attempted
- THEN the provider logs to console and the calling flow continues

#### Scenario: Missing config in production fails loudly

- GIVEN incomplete SMTP configuration in production
- WHEN a send is attempted
- THEN the send MUST be blocked with an explicit, surfaced error
- AND the message MUST NOT be written to console as a substitute for delivery

## Non-Goal Scenarios (MUST NOT happen)

Each mirrors an item deliberately rejected in the proposal's Out-of-Scope list.

#### Scenario: Owner-assignment race is untouched

- GIVEN two concurrent creations for the same `(sourceProvider, sourceEventId)`
- WHEN this feature is deployed
- THEN the ADR-0007 unique-insert dedup and the resulting `ownerId` behave exactly as before

#### Scenario: No per-admin read tracking

- GIVEN admins A and B and a pending `Share Request`
- WHEN A views the pending-requests page
- THEN no per-admin seen/read state is persisted and B's badge is unchanged

#### Scenario: No edit or resubmit of a rejected request

- GIVEN a rejected `Share Request`
- WHEN its author attempts to edit or resubmit it
- THEN no such action exists; the author MUST create a new `Share Request`

#### Scenario: Admin cannot edit a pending request

- GIVEN a pending `Share Request`
- WHEN an `admin` attempts to change its recipient, access type, or day count
- THEN no such action exists; only approve and reject are available

#### Scenario: No email template authoring beyond existing fields

- GIVEN an approved `Share Request`
- WHEN the email is sent
- THEN it populates only the existing `SendEmailInput.text`/`html` fields with no new templating system

## Resolved by sdd-design

**Passive rejection surface for registered recipients** — resolved: `MeetingDetailsView` gains a new
"Solicitudes y accesos" section (all-statuses `Share Request` list + a grants list) inside the existing
"Compartir reunión" card. See `plan.md`'s file table (`MeetingDetailsView.tsx` row) and the two "Member
sees the outcome passively" scenarios above.

## Notes

- Env docs: `README.md` is the only real sync target for the new `SMTP_*` variables — no `.env*.example`
  files exist in this repo (contradicting AGENTS.md's stated convention).
- All new logic is test-first per AGENTS.md, in `apps/__tests__/` mirror paths.
