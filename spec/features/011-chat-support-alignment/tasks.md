# Tasks: Chat Support Alignment

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | PR-A ~90-150 (mostly string-literal edits + 1 flag + 1 corpus doc); PR-B ~140-200 (1 type refactor + 1 enum wiring + 3 corpus edits + 1 new doc + 2 topic answers); total ~230-350 across both PRs |
| 400-line budget risk | Low — each PR independently well under 400; driven by literal/copy edits, not new logic |
| Chained PRs recommended | Yes — already binding per the PR structure decided upstream, not a size-risk trigger |
| Suggested split | PR-A (button placement + Spanish copy) → PR-B (knowledge corpus + status enum), both off `dev` |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main — PR-A and PR-B each branch from `dev` and merge back to `dev` in sequence; PR-B only needs PR-A merged first for corpus consistency (Soporte answer), not a branch-of-branch dependency |

Decision needed before apply: No — PR structure and branch names are already binding; both slices forecast Low risk, so no further chain-strategy choice is needed.
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | `showBugReport` flag + button relocation + Spanish voseo copy + Soporte answer/corpus fix | PR-A (`feat/011-01-report-button-soporte`) | `bun test apps/__tests__/web/components/report-bug-button.logic.test.ts` | Manual: open panel, click Soporte card, confirm button appears under the answer and reset clears it (visual-UI TDD exception, AGENTS.md) | Revert `ChatWidget.tsx`, `ChatMessages.tsx`, `ReportBugButton.tsx`, `reportBugButton.logic.ts`, `documentCorpus.ts` (1 doc), the logic test |
| 2 | `MEETING_STATUSES` canonical export + `searchMeetingsTool` enum consumption + 009/010 corpus refresh | PR-B (`feat/011-02-chat-knowledge-refresh`) | `bun test apps/__tests__/shared/domain/meeting-status.test.ts apps/__tests__/web/integrations/chat-tools-definitions.test.ts` | Manual: ask the assistant "¿por qué mi reunión tiene error de transcripción?" and "¿cómo comparto una reunión?"; confirm answers match 009/010 reality (no public link, transcription_error is recoverable) | Revert `meetingStatus.ts`, `definitions.ts`, `documentCorpus.ts` (2 edits + 1 doc), `ChatMessages.tsx` (2 answers), new test files |

---

## Phase A1: Button placement wiring (PR-A)

> **Revised during implementation.** A1.1-A1.5 originally shipped an `onSupportTopic` callback +
> `isSupport` flag + `useState` mechanism (as in the initial plan.md draft). The mandatory post-apply
> bounded review (R3 Reliability) found that mechanism didn't survive `useChatStream`'s history restore on
> reload — a real regression versus the pre-PR unconditional render. It was replaced with content-derived
> visibility before merge; the callback/flag/data-field were deleted entirely. Checkboxes below describe
> the actually-shipped mechanism.

- [x] A1.1 New `apps/web/src/components/chat/chatWidget.logic.ts`: export `SUPPORT_TOPIC_MARKER = "Reportar un problema"` and `hasSupportTopicMarker(messages): boolean` (pure `.some()` over assistant-role messages containing the marker).
- [x] A1.2 `ChatWidget.tsx`: `const showBugReport = hasSupportTopicMarker(messages) || manualReveal;` — no callback prop passed to `<ChatMessages>`, no `isSupport` field on `STARTER_TOPICS`.
- [x] A1.3 `apps/__tests__/web/components/chat/chat-widget.logic.test.ts` (new, TDD-mandatory): 4 cases — empty list, restored assistant marker, user-role marker (role-gated false), assistant without marker.
- [x] A1.4 `ChatWidget.tsx`: remove the unconditional `<ReportBugButton />` block; render it conditionally (`{showBugReport && (...)}`) directly below the messages area, before the error banner.
- [x] A1.5 `ChatWidget.tsx`: `handleReset` calls `reset()`; derived visibility naturally resolves to hidden once `messages` is empty.
- [x] A1.6 Manual verification (visual exception per AGENTS.md): starter state hides the button; Soporte click reveals it under the answer; a free-text-only thread never shows it; reset returns to starter topics with the button hidden; **a page reload with a Soporte-containing restored history shows the button again** (the regression this revision fixes). Verified via code trace across `ChatWidget.tsx`/`ChatMessages.tsx`/`useChatStream.ts`; recommend a quick human click-through before merge.
- [x] A1.7 (added after R4 Resilience finding) `ChatWidget.tsx`: `manualReveal` state + a persistent "¿Necesitás reportar un problema?" link next to "Nueva conversación", shown when `messages.length > 0 && !showBugReport`; `handleReset` clears it. Closes the gap where a restored conversation without the marker had no button-reachable path except losing history via reset.

## Phase A2: Spanish voseo copy (TDD-mandatory)

- [x] A2.1 RED: update `apps/__tests__/web/components/report-bug-button.logic.test.ts` assertions to the Spanish voseo literals (e.g. `"This report has no meeting diagnostic log."` → `"Este reporte no incluye el diagnóstico de una reunión."`; `"Unable to submit bug report."` → `"No pudimos enviar el reporte."`). Run it — confirm it fails against current English strings.
- [x] A2.2 GREEN: `reportBugButton.logic.ts` — translate all 3 strings (`getBugReportModeNote` fallback; `resolveBugReportFeedback` success `"Bug report submitted. Thank you."` → `"Reporte enviado. ¡Gracias!"`; error fallback). Re-run A2.1, confirm green.
- [x] A2.3 `ReportBugButton.tsx`: translate the 6 UI strings — "Report a bug" → **"Reportar un problema"** (canonical); "Describe what happened..." → "Contanos qué pasó..."; aria-label "Bug report message" → "Mensaje del reporte"; "Submitting..." → "Enviando..."; "Submit report" → "Enviar reporte"; "Cancel" → "Cancelar". No test change (no logic test covers this file — visual exception).

## Phase A3: Soporte answer + corpus line

- [x] A3.1 `ChatMessages.tsx` STARTER_TOPICS Soporte `answer`: delete the "Próximamente" paragraph; replace with copy stating the "Reportar un problema" button (visible right below) sends the issue directly to the support channel now.
- [x] A3.2 `documentCorpus.ts`: add one new doc `support-report-problem` (tags: soporte, reporte, problema, bug) — escalate via the Soporte topic → "Reportar un problema" → goes to the team's support channel; do NOT claim it's upcoming.

## Phase A4: Verification (PR-A)

- [x] A4.1 `bun test apps/__tests__` green; confirm no English literal remains in `reportBugButton.logic.ts`/`ReportBugButton.tsx`/its test.
- [x] A4.2 `bun run lint && bun run typecheck`.
- [x] A4.3 Manual walkthrough per A1.6; confirm `git diff --stat dev` stays under 400 lines before opening PR-A.

---

## Phase B1: Canonical status list (TDD-mandatory)

- [ ] B1.1 RED: create `apps/__tests__/shared/domain/meeting-status.test.ts` asserting `MEETING_STATUSES` contains all 11 statuses incl. `"transcription_error"`, and `getMeetingStatusLabel` resolves a label for every array member. Run it — confirm it fails (`MEETING_STATUSES` doesn't exist yet).
- [ ] B1.2 GREEN: `packages/shared/src/domain/meetingStatus.ts` — invert the source: `export const MEETING_STATUSES = [...] as const;` then `export type MeetingStatus = (typeof MEETING_STATUSES)[number];`, replacing the hand-written union. Re-run B1.1, confirm green; confirm `ALLOWED_TRANSITIONS`/`MEETING_STATUS_LABELS_ES` still typecheck as exhaustive `Record<MeetingStatus, ...>`.

## Phase B2: search_meetings enum consumption (TDD-mandatory)

- [ ] B2.1 RED: extend `apps/__tests__/web/integrations/chat-tools-definitions.test.ts` with a case asserting `searchMeetingsTool.parameters.properties.status.enum` equals `[...MEETING_STATUSES]` (import from `@meeting-bot/shared/domain/meetingStatus`). Run it — confirm it fails (current hardcoded array omits `transcription_error`).
- [ ] B2.2 GREEN: `definitions.ts` — import `MEETING_STATUSES`; replace the hardcoded `status.enum` array with `enum: [...MEETING_STATUSES]`. Re-run B2.1, confirm green.

## Phase B3: Corpus/STARTER_TOPICS refresh (009/010 deltas only)

- [ ] B3.1 `documentCorpus.ts` `meeting-lifecycle` doc: add `transcription_error` — recoverable, recording preserved, reprocesses from storage without rejoining.
- [ ] B3.2 `documentCorpus.ts` `troubleshooting-transcription` doc: mention the `transcription_error` state and the reprocess/regenerate path.
- [ ] B3.3 `documentCorpus.ts`: add new doc `meeting-access-sharing` (009 + ADR-0007) — "dar acceso"/"acceso" vocabulary (never "Access Grant"); "enlace de acceso restringido" por email as the only share type (no public links); per-attendee suggestions on calendar meetings; deactivated-owner lockout; co-attendees of auto-join meetings get access automatically.
- [ ] B3.4 `ChatMessages.tsx` STARTER_TOPICS "Dashboard y reuniones" answer: replace "link público o restringido por email" with restricted-email-only wording; add `transcription_error` to the states list.
- [ ] B3.5 `ChatMessages.tsx` STARTER_TOPICS "Cómo funciona el sistema" answer: add a `transcription_error` recovery note to the flow.

## Phase B4: Verification (PR-B)

- [ ] B4.1 `bun test apps/__tests__` green (new + updated test files).
- [ ] B4.2 `bun run lint && bun run typecheck`.
- [ ] B4.3 Manual walkthrough: ask "¿cómo comparto una reunión?" (restricted-email only, no public link) and about `transcription_error` (recoverable explanation); confirm `git diff --stat dev` stays under 400 lines before opening PR-B.
