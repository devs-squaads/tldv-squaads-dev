# 012 · Per-User Custom Bot Name

**Status:** idea (captured for later — no proposal/design/tasks run yet)

## Purpose

Today the bot's display name comes from a single global default (`BOT_DEFAULT_NAME` env var, falling
back to `"Squaads Assistant"`), overridable only per-meeting via the manual `NewMeetingForm` field. There
is no per-user default: every meeting a given user's calendar auto-joins shows the same generic name.

Let each user connected to the web app set their own default bot name from Settings, so meetings their
account auto-joins show a name they recognize as theirs (e.g. "PMMari's Assistant") instead of the
generic default.

## Rough shape (not yet designed)

- New "Bot configuration" tab in Settings, with a text field to set/change the user's bot name.
- New `bot_name` column on `users` (nullable — falls back to `BOT_DEFAULT_NAME` then the hardcoded default
  when unset).
- `autoJoinService.ts:75` currently hardcodes `process.env.BOT_DEFAULT_NAME || "Squaads Assistant"` with
  no per-user lookup — would need to resolve the event owner's `bot_name` first.
- `meetingWorkerService.ts:214` already has a 3-level fallback (`claimed.botName || BOT_DEFAULT_NAME ||
  "Squaads Assistant"`) — a per-user name would slot in as a new middle tier.

## Open questions (resolve in spec/design phase)

- Does a per-meeting `botName` (manual dashboard/chat invite) still win over the user's default, or does
  the user default only apply to auto-join?
- Any validation/length limit on the custom name (Meet display constraints)?

## Out of scope (this capture)

- No implementation yet. Needs a proper `sdd-propose` → `spec` → `design` → `tasks` pass before coding.
