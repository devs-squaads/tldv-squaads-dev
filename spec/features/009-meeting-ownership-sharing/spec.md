# 009 · Meeting Ownership & Personalized Sharing

**Status:** spec (proposal confirmed)

## Purpose

Every recording MUST belong to exactly one **Owner**. Access is restricted to that Owner plus
explicit, personalized **Access Grants** — never a public link — and optionally time-boxed. As a
secondary goal, S3 object keys MUST encode meeting name and date for operational readability and
persist that key so future naming changes never desync from already-uploaded objects.

Domain vocabulary is fixed by `docs/CONTEXT.md` (section "Meeting Ownership & Sharing"): **Owner**,
**Access Grant**, **Participant**. This spec uses those exact terms — no synonyms.

## Requirements

### Requirement: Meeting Owner assignment

The system MUST persist `meetings.ownerId` as a `NOT NULL` foreign key to `users.id`, set at meeting
creation to the authenticated user who ran `INVITE_BOT` or queued the meeting. The Owner MUST NOT be
derived from `organizerEmail` or any calendar metadata.

#### Scenario: Owner captured at creation from the acting session

- GIVEN an authenticated user queues a meeting or triggers `INVITE_BOT`
- WHEN the `meetings` row is created
- THEN `ownerId` is set to that user's `users.id`
- AND it is never populated from `organizerEmail`

#### Scenario: Owner is mandatory

- GIVEN a meeting-creation path that cannot resolve an authenticated `users.id`
- WHEN it attempts to insert a `meetings` row
- THEN the insert MUST fail (column is `NOT NULL`) rather than create an ownerless meeting

### Requirement: Ownership-scoped meeting visibility (no role bypass)

Every authenticated user's meeting list MUST be scoped to meetings they own PLUS meetings where they
hold a live (non-expired, non-revoked) Access Grant. `authorized_accounts.role` (admin/member) MUST
NOT grant visibility into another user's meetings.

#### Scenario: Owner sees only their meetings and granted meetings

- GIVEN user A owns meeting M1 and holds a live Access Grant on meeting M2 owned by B
- WHEN A lists or opens meetings
- THEN A sees M1 and M2
- AND A does not see any other user's meetings

#### Scenario: Admin role does not bypass ownership

- GIVEN user A has `authorized_accounts.role = admin` and neither owns nor is granted meeting M
- WHEN A lists or opens meetings
- THEN M MUST NOT appear and opening it MUST be denied

#### Scenario: Non-owner without a grant is denied

- GIVEN meeting M owned by B with no Access Grant for user A
- WHEN A requests M's list entry or detail
- THEN access MUST be denied

### Requirement: Owner-only Access Grants

Only a meeting's Owner MAY create or revoke Access Grants for that meeting. A grantee MUST NOT
re-share (no grant chains). `meeting_access_grants` MUST record the grantee as a registered
`users.id` (session-based) with an optional `expiresAt` drawn from the existing share TTL menu
(`DEFAULT_SHARE_TTL_OPTIONS_MINUTES`: 1h / 1d / 7d / no-expiry).

#### Scenario: Owner grants read access with a TTL option

- GIVEN Owner O of meeting M and registered user G
- WHEN O creates an Access Grant for G choosing a TTL from the existing menu (or no-expiry)
- THEN a `meeting_access_grants` row is created with `granteeUserId = G`, `grantedBy = O`, and the chosen `expiresAt` (or null)

#### Scenario: Non-owner cannot grant

- GIVEN user X who is not the Owner of meeting M (grantee or unrelated)
- WHEN X attempts to create or revoke an Access Grant on M
- THEN the operation MUST be rejected

#### Scenario: Expired or revoked grant confers no access

- GIVEN an Access Grant whose `expiresAt` has passed or whose `revokedAt` is set
- WHEN the grantee lists or opens the meeting
- THEN access MUST be denied

### Requirement: Owner-only share authorization (fix createShareAction)

`createShareAction` MUST require the caller to be the meeting's Owner. A non-Owner MUST NOT create a
share for a meeting they do not own.

#### Scenario: Owner creates a share

- GIVEN Owner O of meeting M
- WHEN O calls `createShareAction` for M
- THEN the share is created

#### Scenario: Non-owner is rejected

- GIVEN authenticated user X who does not own meeting M
- WHEN X calls `createShareAction` for M
- THEN it MUST be rejected (previously: no authorization check existed)

### Requirement: Remove public share type

`meeting_shares.shareType` MUST NOT support `"public"` — removed from the enum, provider,
`MeetingDetailsView`, and the chat share tool. `"restricted_email"` (OTP-gated by email, no
registration required) MUST remain unchanged as the mechanism for external/non-registered people. The
migration MUST revoke any existing `"public"` rows.

#### Scenario: Public shares can no longer be created

- GIVEN the sharing UI or the chat share tool
- WHEN any caller attempts to create a share of type `"public"`
- THEN the option MUST NOT exist and the attempt MUST be rejected

#### Scenario: Existing public shares revoked at migration

- GIVEN pre-existing `meeting_shares` rows with `shareType = "public"`
- WHEN the migration runs
- THEN those rows MUST be revoked

#### Scenario: restricted_email is preserved

- GIVEN a share of type `"restricted_email"`
- WHEN it is created or consumed after this change
- THEN it MUST behave exactly as before (email OTP gate, no registration required)

### Requirement: Participant suggestions for calendar-sourced meetings

For meetings created from a Google Calendar event, the system MUST capture `event.attendees` as
**Participant** suggestions and offer them as sharing candidates once the recording completes. The
Owner MUST grant/share to each Participant individually — the system MUST NOT provide a single
"grant all at once" action. Ad-hoc meetings (no calendar event) MUST have no suggested list; the
Owner enters recipient emails manually.

#### Scenario: Attendees surfaced as per-participant suggestions

- GIVEN a completed recording for a meeting created from a calendar event with attendees
- WHEN the Owner opens sharing
- THEN each attendee appears as an individual Participant suggestion the Owner confirms one at a time
- AND no bulk grant-all action is offered

#### Scenario: Ad-hoc meeting has no suggestions

- GIVEN a meeting created from a pasted link (no calendar event)
- WHEN the Owner opens sharing
- THEN no suggested Participant list is shown and the Owner enters emails manually

### Requirement: Deactivated Owner lockout

When an Owner's `authorized_accounts.isActive` is `false`, ALL of that Owner's meetings MUST become
inaccessible to everyone, including existing grantees — with no carve-out for already-granted access.

#### Scenario: Deactivation locks out grantees

- GIVEN meeting M owned by O with a live Access Grant for grantee G
- WHEN O's account is set `isActive = false`
- THEN neither O nor G can list or open M

### Requirement: Recording storage key naming and persistence

New uploads MUST compute the S3 key once at upload time as
`${provider}/${sanitizedMeetingName}_${YYYY-MM-DD}_${meetingId}.mp4` and persist it in
`meetings.recordingStorageKey`. Delete/sign/download MUST use the persisted key when present. Rows
where `recordingStorageKey` is null MUST fall back to the current `buildRecordingStorageKey()` formula
unchanged. Existing rows MUST NOT be backfilled.

#### Scenario: New upload persists the readable key

- GIVEN a recording being uploaded for meeting M
- WHEN the upload completes
- THEN `meetings.recordingStorageKey` is set to `${provider}/${sanitizedMeetingName}_${YYYY-MM-DD}_${meetingId}.mp4`
- AND delete/sign/download resolve the object via that stored key

#### Scenario: Legacy rows use the fallback formula

- GIVEN a pre-existing recording whose `recordingStorageKey` is null
- WHEN delete/sign/download resolves its key
- THEN it uses `buildRecordingStorageKey()` (`${provider}/${meetingId}.mp4`), unchanged

## Non-Goals

- **Real/automated email delivery** — `EmailProviderFactory` stays console/no-op; the Owner shares
  links manually, same as today.
- **Participant capture for non-calendar meetings** — ad-hoc meetings never get a suggested list.
- **Extension `INVITE_BOT`/`STOP_BOT` per-meeting ownership check** — pre-existing gap owned by
  feature 008 (separate branch), not this change.
- **Backfilling `recordingStorageKey`** for meetings uploaded before this change.
- **Owner transfer / admin reassignment** for a deactivated Owner's meetings — they become
  inaccessible, not reassigned.

## Migration Note

Existing `meetings` and related rows are test data; a DB reset accompanies this migration, so
`ownerId NOT NULL` needs no backward-compatibility path.
