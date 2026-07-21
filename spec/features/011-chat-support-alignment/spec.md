# 011 · Chat Support Alignment

**Status:** spec
**Branch:** feature branches off `dev` (PR-A then PR-B, sequential)

## Purpose

Realign the Squaads Assistant's UI, copy, and knowledge with the shipped product. The Soporte topic
falsely claims support is "Próximamente" while the bug-report → Discord flow already renders in the same
panel; the `ReportBugButton` is loose at the panel bottom and 100% English inside an all-Spanish (voseo)
UI; the corpus/`STARTER_TOPICS` still describe pre-009/010 behavior (public share links, missing
`transcription_error`); and `searchMeetingsTool` hardcodes a status enum that omits `transcription_error`.

Domain vocabulary is fixed by root `CONTEXT.md` — this spec uses those exact terms: **Reportar un
problema**, **Soporte**, **Acceso** / **dar acceso**, **Enlace de acceso restringido**. Two sequential
PRs, each under the 400-line budget.

---

## PR-A — Report button placement + Spanish copy

### Requirement: ReportBugButton renders only after a Soporte topic-card click

The system MUST render `ReportBugButton` inside the chat panel ONLY after the user clicks the Soporte
topic card. Placement MUST be driven by a local `showBugReport` flag in `ChatWidget.tsx` (no topic-id
pipeline, no intent detection). `reset()` MUST clear the flag. The button MUST NOT appear in the starter
state or during an unrelated free-text conversation. *(Visual-exception: button placement/rendering is
validated manually per the repo's visual-UI TDD exception.)*

#### Scenario: Soporte click reveals the button and the corrected answer

- GIVEN the assistant is in the starter state
- WHEN the user clicks the Soporte topic card
- THEN the corrected Soporte answer renders (no "Próximamente" claim)
- AND the "Reportar un problema" button becomes visible in the panel

#### Scenario: Free-text conversation does not reveal the button

- GIVEN the user has started a free-text conversation without clicking Soporte
- WHEN messages exist in the thread
- THEN the "Reportar un problema" button MUST NOT be visible

#### Scenario: Reset returns to starter state with the button hidden

- GIVEN Soporte was clicked and the button is visible
- WHEN the user resets the conversation
- THEN the starter topics render again
- AND the `showBugReport` flag is cleared so the button is hidden

### Requirement: All ReportBugButton copy is Spanish (voseo)

The system MUST translate the 9 English strings across `ReportBugButton.tsx` and
`reportBugButton.logic.ts` to Spanish voseo. The collapsed-button label MUST be the canonical
"Reportar un problema" (per `CONTEXT.md`). Remaining strings (placeholder, aria-label, submit/submitting
label, cancel, success/error feedback) MUST also be voseo. *(TDD-mandatory: `reportBugButton.logic.ts`
strings — `report-bug-button.logic.test.ts` asserts the English literals verbatim and MUST be updated
test-first in the same PR.)*

#### Scenario: Logic test asserts the Spanish literals

- GIVEN `report-bug-button.logic.test.ts` currently asserts English literals
- WHEN the logic strings are translated to voseo
- THEN the test is updated first to assert the Spanish literals
- AND `bun test apps/__tests__` passes with no English literal remaining

### Requirement: Soporte canned answer and one corpus line teach the report path

The system MUST remove the false "Próximamente" claim from the Soporte answer in `STARTER_TOPICS`
(`ChatMessages.tsx`) and add exactly one corpus line teaching the assistant that a user reports a problem
via the Soporte topic (so PR-A is self-consistent).

#### Scenario: Assistant explains the Soporte report path in free text

- GIVEN a user is in a free-text conversation
- WHEN the user asks how to report a problem
- THEN the assistant explains the report lives in the Soporte topic ("Reportar un problema")
- AND does NOT claim the feature is upcoming/"Próximamente"

---

## PR-B — Knowledge corpus refresh + status enum root-cause fix

### Requirement: Corpus/STARTER_TOPICS reflect 009/010 reality only

The system MUST update the corpus and `STARTER_TOPICS`, scoped to 009/010 deltas ONLY: use
"dar acceso"/"acceso" vocabulary (never "Access Grant" in user copy); state "enlace de acceso restringido"
as the only share type and remove any "link público" claim; document participant suggestions,
deactivated-owner lockout, `transcription_error` + recovery, and ADR-0007 co-attendee auto-grant. No other
corpus docs are touched.

#### Scenario: Corpus no longer offers public links

- GIVEN the corpus previously described a public share link
- WHEN a user asks how to share a meeting
- THEN the assistant describes only an "enlace de acceso restringido" (restricted email)
- AND MUST NOT mention public/"link público" sharing as a current option

#### Scenario: Corpus reflects transcription_error recovery

- GIVEN a meeting reached `transcription_error`
- WHEN a user asks why a meeting shows a transcription error
- THEN the assistant explains the recording is safe and can be reprocessed from storage

### Requirement: search_meetings status enum sourced from shared canonical list

The system MUST export a canonical meeting-status list from `packages/shared/src/domain/meetingStatus.ts`
and have `searchMeetingsTool` (`apps/web/src/integrations/chat/tools/definitions.ts`) consume it instead
of a hardcoded array, so the tool accepts every real status including `transcription_error`. *(TDD-mandatory:
the enum export and its consumption — test-first.)*

#### Scenario: search_meetings accepts transcription_error

- GIVEN the `search_meetings` tool receives a status filter of `transcription_error`
- WHEN the tool schema validates the argument
- THEN `transcription_error` is a valid value (not rejected)
- AND the accepted set matches the shared canonical status list exactly

#### Scenario: Adding a status cannot drift the tool

- GIVEN a new status is added to the shared canonical list
- WHEN `searchMeetingsTool` builds its schema
- THEN the tool's accepted statuses include the new value with no separate edit

---

## Non-Goals

- No i18n layer — direct string-literal edits only (no framework introduced).
- No full 18-doc corpus audit — only 009/010 deltas + the two confirmed falsehoods.
- No intent-detection or topic-id pipeline for button placement — local flag only.
- No app-wide voseo/tuteo normalization (`MeetingDetailsView` tuteo stays as-is).
- No `roadmap.md` refresh (known stale — separate follow-up).
- No change to `manage_meeting_share` behavior (tool already correct; only copy was wrong).
- No deployment-contract file changes (`Dockerfile.*`, `docker-compose*.yml`, `railway.json`, CI).
