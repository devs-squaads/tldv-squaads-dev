# Auto-join co-attendees get automatic Access Grant instead of a manual-share suggestion

## Status

Accepted

## Context

ADR/spec 009 established that a meeting's `Owner` always decides and triggers sharing — `Participant`
(a calendar attendee) is only ever a suggestion surfaced in the UI, never an automatic grant. That rule
was written with the manual origination paths in mind (`INVITE_BOT` from the extension, or enqueueing
from the dashboard/chat), where a human consciously decided to record and can just as consciously decide
to share afterward.

Auto-join breaks that assumption. When a calendar event lists two registered users as attendees (e.g. an
external client schedules a meeting and invites our PM and our Comercial, both with Google Calendar
auto-join enabled), each user's independent calendar poll detects the same event and enqueues it. Fixing
the resulting duplicate-bot race (see the `meetings(source_provider, source_event_id)` unique constraint)
means exactly one of the two ends up as `Owner` — but which one is arbitrary, decided by which poll cycle
wins the insert race, not by either person's choice. Neither user consciously chose to record, and neither
consciously chose who the `Owner` would be. Under the strict 009 rule, the other attendee would silently
never see the recording unless the accidental `Owner` remembered to go share it by hand — in practice, for
a fully automated flow, that never happens.

## Decision

For meetings that originate from calendar auto-join only, when a `Participant` email matches another
registered user (not the resolved `Owner`), create their `Access Grant` automatically at insertion time —
no `Owner` action required. Manually-originated meetings (`INVITE_BOT`, dashboard/chat enqueue) are
unaffected: `Participant` there remains a suggestion only, per the existing 009 model.

The automatic grant is scoped narrowly: it only ever applies to users who (a) are already registered,
authorized accounts with full login access to the app, and (b) were actually invited to this specific
calendar event as an attendee. It never grants access to an unregistered email, and never grants access
to a registered user who wasn't an attendee of the triggering event.

## Consequences

- `meeting_access_grants` rows can now exist without any `Owner`-initiated action for auto-join-sourced
  meetings — code and audits that assumed "every grant traces back to an explicit Owner action" need to
  check `meetings.sourceProvider`/`sourceEventId` to distinguish the two origins.
- The grant is still revocable exactly like any other `Access Grant` — if the accidental `Owner` revokes
  it, it must not be silently re-created on a later auto-join poll (idempotency requirement carried by the
  implementing repository method).
