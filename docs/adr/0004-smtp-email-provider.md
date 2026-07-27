# SMTP Email Provider (Nodemailer)

`EmailProviderFactory` has only ever had a `ConsoleEmailProvider` (logs to console, sends nothing) — a
known gap documented since ADR-0005: sharing links are not emailed automatically, the Owner copies and
sends them by hand. We close that gap with a new `SmtpEmailProvider implements EmailProvider`, built on
Nodemailer against plain SMTP credentials (`SMTP_HOST`/`PORT`/`USER`/`PASS`/`FROM`), selected via the
existing `EMAIL_PROVIDER` env var in `EmailProviderFactory`. No caller changes: `RestrictedEmailSharingProvider`
and `meetingShareService.ts` already call `EmailProviderFactory.getProvider().send(...)`, so wiring in a
real provider is a drop-in swap, not a new integration point.

## Status

accepted

## Considered Options

- **Resend's native API/SDK**: rejected — couples the codebase to one vendor's API shape instead of the
  provider-agnostic `EmailProvider` interface already in place; SMTP works with Resend too (as one of
  several interchangeable hosts) without that coupling.
- **Supabase's built-in auth mailer**: not applicable — this project's `Session Auth` is NextAuth, not
  Supabase Auth; there is no Supabase invite-link flow to intercept.
- **Leave `ConsoleEmailProvider` as the only implementation indefinitely**: rejected — blocks every
  sharing flow already built in feature 009 (`restricted_email` shares, OTP codes) from ever reaching a
  real inbox, and now also blocks the `Share Request` approval flow (ADR-0008) from notifying anyone.

## Consequences

- New env vars (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`) need README + all
  `.env.*.example` updates in the same change, per `AGENTS.md`'s env-docs-sync rule.
- `nodemailer` becomes a real declared dependency of `apps/web` (today it only appears transitively in
  `bun.lock`, not in any `package.json`).
- `SendEmailInput.text` stays the plain-text fallback; `html` (already optional on the interface) starts
  actually being populated — template authoring is a separate, later concern, not part of this decision.
- Missing/incomplete SMTP env vars fall back to console logging in local/dev, matching the behavior every
  other provider factory in this codebase already follows. In **production**, the opposite: missing SMTP
  config must fail loudly and block the send — a silent console-only "email" in production means a real
  recipient never gets anything and nobody notices. `SmtpEmailProvider` needs an explicit production check
  (e.g. `NODE_ENV`/`ROLE`-aware) to enforce this distinction.
