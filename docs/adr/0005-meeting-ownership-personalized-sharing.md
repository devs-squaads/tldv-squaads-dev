# Meeting Ownership and Personalized Sharing Model

Every meeting gets an `Owner` (`meetings.ownerId`, `NOT NULL` FK to `users.id`) captured at creation —
the authenticated user who ran `INVITE_BOT` or queued the meeting, not `organizerEmail` (calendar
metadata that may not correspond to any registered user). By default only the Owner can access a
meeting; a new `meeting_access_grants` table lets the Owner grant read access to specific registered
users, session-based, no re-sharing chains. The existing `meeting_shares` table (anonymous/token-based
external sharing) is kept for non-registered participants, but its `"public"` type is removed — a link
requiring no identity check contradicts the product requirement that access is always personalized.
`authorized_accounts.role` (`admin`/`member`) stays orthogonal to meeting visibility: no role bypasses
ownership. Existing (test) meeting rows are handled by a DB reset alongside the migration, not a
backward-compatible nullable owner.

## Status

accepted

## Considered Options

- **Extend `meeting_shares` with an `"internal_user"` type instead of a new table**: rejected — that
  table's `tokenHash`/`otpHash` fields are meaningless for a session-based grant; the two are different
  authorization primitives (anonymous/token vs. session/registered-user).
- **Keep the `"public"` share type, scope this change to ownership only**: rejected — the product
  requirement is explicit ("always personalized access"); a public link is the opposite by definition.
- **Role-based visibility (admins see all meetings)**: rejected — no product requirement surfaced for
  it, and it reintroduces the same "anyone in the org sees everything" problem this change removes.
- **Nullable `ownerId` with a legacy fallback (unowned meetings visible to all)**: rejected — existing
  meeting rows are test data; a DB reset alongside the migration is simpler than fallback logic no one
  needs.

## Consequences

- Fixes the current gap where `WebMeetingRepository.listRecent()` lists every meeting for every
  authorized user with no ownership filter.
- Fixes `createShareAction` having no authorization check today (any authenticated user can currently
  share any meeting) — only the Owner may create or revoke grants/shares for their own meeting.
- Removing `"public"` is a breaking change to `MeetingDetailsView.tsx` and the chat share tool
  (`integrations/chat/tools/definitions.ts`) — both need updating in the same change, and any
  already-created `"public"` shares are revoked at migration time (a live public link is exactly what
  this ADR removes).
- Meetings created from a Google Calendar event capture `event.attendees` as sharing suggestions once
  the recording completes (see `docs/CONTEXT.md` — `Participant`); the Owner still explicitly triggers
  each grant/share, this is not automatic. Meetings without a calendar event (ad-hoc pasted links) have
  no suggested list — the Owner types recipient emails manually.
- Known gap, not built in this change: there is no real email provider (`EmailProviderFactory` only has
  a console/no-op implementation in production) — sharing links are not emailed automatically. The Owner
  must copy and send the link manually until a real provider is wired in a future change.
