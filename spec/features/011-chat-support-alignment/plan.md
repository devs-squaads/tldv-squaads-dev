# Design: Chat Support Alignment (011)

## Technical Approach

Two sequential PRs, both web-only content/UI changes plus one shared-domain export. No schema, migration, or deploy-contract change. PR-A makes the support UX self-consistent (button placement + Spanish copy + Soporte answer). PR-B refreshes the assistant's knowledge for the 009/010 deltas and fixes the `search_meetings` status enum at its root cause (single source of truth in `packages/shared`).

## PR-A — Button + copy

### Wiring the `showBugReport` flag (binding: no topic-id pipeline)

`onQuickReply(question, answer)` carries no topic identity, and `DisplayMessage` must not grow one. Smallest viable wiring: a second, optional callback that only the Soporte card fires.

- `ChatMessages.tsx`: add `onSupportTopic?: () => void` to `ChatMessagesProps`. Mark the Soporte entry in `STARTER_TOPICS` with `isSupport: true` (data field on the const, never persisted). In the card map: `onClick={() => { onQuickReply(question, answer); if (isSupport) onSupportTopic?.(); }}`.
- `ChatWidget.tsx`: `const [showBugReport, setShowBugReport] = useState(false)`; pass `onSupportTopic={() => setShowBugReport(true)}`.

### Render position (post-move)

Remove the unconditional block at `ChatWidget.tsx:234-236`. Render conditionally directly below the messages area (line ~158, before the error banner), so the button sits visually under the Soporte answer:

```tsx
{showBugReport && (
  <div className="flex justify-center pb-2"><ReportBugButton /></div>
)}
```

### Reset behavior

Wrap the "Nueva conversación" handler: `const handleReset = () => { setShowBugReport(false); reset(); }` and point the button's `onClick` at it. Reset → messages cleared → `STARTER_TOPICS` starter state returns (renders when `messages.length === 0`), flag cleared. Flag is session-scoped in-memory state; closing the panel keeps it (accepted per grill decision).

### The 9 string translations (voseo)

`ReportBugButton.tsx` (6): "Report a bug" → **"Reportar un problema"** (canonical, CONTEXT.md); "Describe what happened..." → "Contanos qué pasó..."; aria-label "Bug report message" → "Mensaje del reporte"; "Submitting..." → "Enviando..."; "Submit report" → "Enviar reporte"; "Cancel" → "Cancelar".

`reportBugButton.logic.ts` (3): "This report has no meeting diagnostic log." → "Este reporte no incluye el diagnóstico de una reunión."; "Bug report submitted. Thank you." → "Reporte enviado. ¡Gracias!"; "Unable to submit bug report." → "No pudimos enviar el reporte."

Note: `MeetingDetailsView.tsx` reuses `ReportBugButton` (with `meetingId`) — it inherits the Spanish strings; no per-usage change.

### Soporte canned answer + corpus line

- `ChatMessages.tsx` STARTER_TOPICS Soporte `answer`: delete the "Próximamente" paragraph; replace with copy stating the report path exists now: press "Reportar un problema" under this answer to send the issue directly to the support channel.
- `documentCorpus.ts`: add one small doc `support-report-problem` (tags: soporte, reporte, problema, bug) teaching the assistant: to escalate, open the Soporte topic and press "Reportar un problema"; the report goes to the team's support channel.

## PR-B — Knowledge + enum

### Canonical status list export

Invert the source in `packages/shared/src/domain/meetingStatus.ts`: define one `as const` array and derive the union from it — the union then cannot drift from the list, and every existing `Record<MeetingStatus, ...>` stays exhaustively compiler-checked:

```ts
export const MEETING_STATUSES = ["pending", "joining", "waiting_admission", "recording",
  "transcribing", "summarizing", "completed", "admission_timeout", "rejected",
  "error", "transcription_error"] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];
```

| Option | Tradeoff | Decision |
|---|---|---|
| `as const` array → derive union | Array is SSOT; type-level exhaustiveness preserved | **Chosen** |
| `Object.keys(MEETING_STATUS_LABELS_ES)` | Runtime-only; labels record is private; loses tuple typing | Rejected |
| Keep union, hand-maintain array | Exactly the drift this fixes | Rejected |

Consumption in `definitions.ts` (`searchMeetingsTool`): `enum: [...MEETING_STATUSES]` (spread — JSON-schema field is mutable `string[]`). Imports from `@meeting-bot/shared/domain/meetingStatus` already exist.

### Corpus/topic edits (009/010 deltas only)

- `meeting-lifecycle` doc: add `transcription_error` — recoverable, grabación conservada, se reintenta desde el detalle sin re-unirse.
- `troubleshooting-transcription` doc: mention the `transcription_error` state and the regenerate path.
- New doc `meeting-access-sharing` (009 + ADR-0007): "dar acceso"/"acceso" vocabulary (never "Access Grant" in copy); "enlace de acceso restringido" por email is the only share type (no public links); per-attendee suggestions on calendar meetings; deactivated-owner lockout; co-attendees of auto-join meetings get access automatically.
- STARTER_TOPICS answers changed: **"Dashboard y reuniones"** (replace "link público o restringido por email" with restricted-email access wording; add `transcription_error` to the states list) and **"Cómo funciona el sistema"** (add `transcription_error` recovery note to the flow). Soporte was fixed in PR-A; other topics untouched.

## File Changes

| File | PR | Action |
|---|---|---|
| `apps/web/src/components/chat/ChatWidget.tsx` | A | flag, conditional render, handleReset |
| `apps/web/src/components/chat/ChatMessages.tsx` | A+B | A: `onSupportTopic`, Soporte answer; B: 2 topic answers |
| `apps/web/src/components/bug-report/ReportBugButton.tsx` | A | 6 strings |
| `apps/web/src/components/bug-report/reportBugButton.logic.ts` | A | 3 strings |
| `apps/__tests__/web/components/report-bug-button.logic.test.ts` | A | Spanish literal assertions (test-first) |
| `apps/web/src/integrations/chat/knowledge/documentCorpus.ts` | A+B | A: 1 doc; B: 2 edits + 1 doc |
| `packages/shared/src/domain/meetingStatus.ts` | B | `MEETING_STATUSES` export, derived union |
| `apps/web/src/integrations/chat/tools/definitions.ts` | B | enum from shared list |
| `apps/__tests__/shared/domain/meeting-status.test.ts` | B | Create (test-first) |
| `apps/__tests__/web/integrations/chat-tools-definitions.test.ts` | B | enum assertion (test-first) |

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Unit (PR-A, RED first) | `reportBugButton.logic.ts` returns Spanish strings | Update literal assertions before translating |
| Unit (PR-B, RED first) | `MEETING_STATUSES` contains all 11 statuses incl. `transcription_error`; label lookup works for every array member | New `apps/__tests__/shared/domain/meeting-status.test.ts` |
| Unit (PR-B, RED first) | `searchMeetingsTool.parameters.properties.status.enum` equals `MEETING_STATUSES` | Extend `chat-tools-definitions.test.ts` |
| Visual (exception) | Button renders only after Soporte click; cleared on reset | Manual — per AGENTS.md pure-visual UI exception; no component tests exist for this area |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.

## Migration / Rollout

No migration. Two sequential PRs to `dev`, each under the 400-line budget; revert = revert PR commit. Corpus-gap window between PRs accepted (PR-A is self-consistent).

## Open Questions

None — all shaping decisions resolved in the binding grill session.
