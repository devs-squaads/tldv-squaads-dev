# 008 · Extension Stop-Recording Action — Tasks

_Derived from `plan.md` (mirrors `INVITE_BOT` 1:1) and `spec.md` (R1-R8). TDD: RED → GREEN → REFACTOR,
tests in `apps/__tests__/`. Widget UI wiring is the AGENTS.md visual exception (manual validation)._

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~430-480 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 → PR2 → PR3 → PR4 |
| Delivery strategy | ask-on-risk (default) |
| Chain strategy | pending — ask user |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | PR | Focused test | Harness | Rollback |
|---|---|---|---|---|---|
| 1 | Schema + stop route (R6,R7) | PR1 | `bun test apps/__tests__/web/routes/extension-meetings-stop-route.test.ts` | N/A, unit-tested | Drop column, delete route |
| 2 | `STOP_BOT` messaging | PR2 | `bun test apps/__tests__/web/extension` | N/A, mocked fetch | Revert types/api-client/SW |
| 3 | Worker stop check (R8) | PR3 | `bun test apps/__tests__/worker/bot` | Manual: real Meet | Revert `OnlineMeetingProvider` |
| 4 | Widget state machine (R1-R4) + wrap-up | PR4 | `bun test apps/__tests__/extension/shared/status-sync.test.ts` | Manual: real Meet | Revert `widget.ts`/`status-sync.ts` |

## Phase 1: Schema (PR1)

- [ ] 1.1 Add `stopRequestedAt` timestamp to `meetings` in `packages/shared/src/db/schema.ts` (after `endsAt`). No test — declarative.
- [ ] 1.2 `bun run db:push`.

## Phase 2: Stop Route (PR1)

- [ ] 2.1 RED: `apps/__tests__/web/routes/extension-meetings-stop-route.test.ts` — 401, 404, 409 non-recording, 200 sets `stopRequestedAt`, idempotent repeat (R6,R7).
- [ ] 2.2 GREEN: `apps/web/src/app/api/v1/extension/meetings/[id]/stop/route.ts` per `plan.md` §3.

## Phase 3: Extension Messaging (PR2)

- [ ] 3.1 Add `STOP_BOT` to `RuntimeMessage` in `apps/extension/src/shared/types.ts`.
- [ ] 3.2 RED: extend `apps/__tests__/web/extension/api-client.test.ts` — `stopBot()` POSTs `/api/meetings/{id}/stop`, resolves ok, throws on error.
- [ ] 3.3 GREEN: `stopBot()` in `apps/extension/src/background/api-client.ts`, mirrors `inviteBot()`.
- [ ] 3.4 Wire `case "STOP_BOT"` in `service-worker.ts` `handleMessage`. Mirrors untested `INVITE_BOT` case; logic already covered by 3.2/3.3.

## Phase 4: Worker Stop Check (PR3)

- [ ] 4.1 RED: `apps/__tests__/worker/bot/online-meeting-provider-stop.test.ts` (mock `MeetingRepository`/`stopRecording`) — set → stop called once; unset → no call; already-completed race → no call/no error (R8).
- [ ] 4.2 GREEN: add check in `record()`'s poll tick, `apps/worker/src/bot/providers/OnlineMeetingProvider.ts`; thread `meetingId` from `bot/index.ts` and `meetingWorkerService.ts`.

## Phase 5: Widget State Machine (PR4)

- [ ] 5.1 RED: extend `status-sync.test.ts` — `stopGuardElapsed(enteredAt, now, minMs)`: null→false, <5000→false, ≥5000→true.
- [ ] 5.2 GREEN: `stopGuardElapsed` + `"stop_confirm" | "stopping"` in `apps/extension/src/shared/status-sync.ts`.
- [ ] 5.3 Wire widget: state union, `#squaads-stop-btn`, handlers in `apps/extension/src/content/widget.ts` per `plan.md` §8. Visual — no unit test (AGENTS.md exception).
- [ ] 5.4 Manual validation on real Meet: confirm blocks single-click (R3), 5s guard (R2), optimistic "stopping…" resolves via Port (R4).

## Phase 6: Wrap-up

- [ ] 6.1 `bun run extension:build`.
- [ ] 6.2 Update `docs/extension.md` for `stop_confirm`/`stopping`.
- [ ] 6.3 Validate against `spec.md`; move 008 to "Hecho" in `spec/constitution/roadmap.md`.
