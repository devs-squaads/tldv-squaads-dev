# Tasks: Meeting Ownership & Personalized Sharing (+ S3 Naming)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~2000-2100 (7 work units, ~120-400 each) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 → {PR2, PR3, PR4, PR7 parallel} → {PR5 → PR6} |
| Delivery strategy | ask-on-risk (default, none supplied) |
| Chain strategy | pending — user decision needed |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | Schema + migration + `UserRepository` | PR1 (base) | `bun test apps/__tests__/shared/repositories/user-repository.test.ts` | `bun run infra:reset` | Revert schema.ts, migration file, UserRepository.ts |
| 2 | Owner capture at all creation paths | PR2 (needs PR1) | `bun test apps/__tests__/shared/services/meeting-queue-service.test.ts apps/__tests__/web/api/bot-start.test.ts` | `bun run dev` — queue via dashboard/extension | Revert queueMeetingRun/EnqueueMeetingCommand/bot routes |
| 3 | Ownership-scoped reads | PR3 (needs PR1, parallel PR2) | `bun test apps/__tests__/web/repositories/web-meeting-repository.test.ts` | N/A — query-layer, unit-covered | Revert WebMeetingRepository.ts + page callers |
| 4 | Access Grants (repo/service/action) | PR4 (needs PR1, parallel PR2/3) | `bun test apps/__tests__/shared/repositories/meeting-access-grant-repository.test.ts apps/__tests__/web/services/meeting-access-grant-service.test.ts` | N/A — service-layer, unit-covered | Revert shareTtl.ts, MeetingAccessGrantRepository/Service, grants.ts |
| 5 | Share authorization retrofit | PR5 (needs PR4) | `bun test apps/__tests__/web/services/meeting-share-service.test.ts` | N/A — service-layer, unit-covered | Revert meetingShareService.ts callerId check, shares.ts |
| 6 | Remove public share + participant suggestions | PR6 (needs PR2, PR4, PR5) | `bun test apps/__tests__/web/integrations/chat-tools-definitions.test.ts` | `bun run dev:web` — manual sharing UI walkthrough | Revert sharing types/Factory/delete file, MeetingDetailsView.tsx, definitions.ts |
| 7 | S3 storage key naming | PR7 (needs PR1 only, fully parallel) | `bun test apps/__tests__/shared/meeting-provider.test.ts` | `bun run dev:worker` — record+upload, verify key persisted | Revert meetingProvider.ts additions + 6 resolve-then-fallback sites |

PR2/PR4 sit near the 400-line edge; split further at apply time if actual diff overruns.

## Phase 1: Schema & Migration Foundation

- [x] 1.1 `packages/shared/src/db/schema.ts`: add `meetings.ownerId` (NOT NULL FK users.id), `recordingStorageKey`, `participantEmails`; new `meetingAccessGrants` table; `shareTypeEnum` drops `"public"`.
- [x] 1.2 `drizzle/0006_meeting_ownership_and_sharing.sql`: revoke+relabel existing `"public"` rows, recreate `share_type` enum, add new columns/table.
- [x] 1.3 RED+GREEN: `packages/shared/src/repositories/UserRepository.ts` (`findByEmail`) + `apps/__tests__/shared/repositories/user-repository.test.ts`.
- [x] 1.4 Apply migration via `bun run infra:reset` + `bun run db:push`; confirmed schema loads clean against a fresh local DB (2026-07-20). No pre-existing meeting/db containers reused — stale containers from a prior session (`meeting-db`, `meeting-storage`, `meeting-storage-mc`, `meeting-worker`) were removed first since they conflicted with `docker compose up`.

## Phase 2: Owner Capture at Creation

- [ ] 2.1 RED+GREEN: `meetingQueueService.ts` — mandatory `ownerId`, optional `participantEmails`, threaded to insert — `apps/__tests__/shared/services/meeting-queue-service.test.ts`.
- [ ] 2.2 Thread `ownerId`: `EnqueueMeetingCommand.ts`, `meetingService.ts`, `app/actions/bot.ts` (session, 401 without `session.user.id`), `api/v1/extension/bot/start/route.ts` (`auth.payload.userId`, no new logic).
- [ ] 2.3 RED+GREEN: legacy `api/bot/start/route.ts` requires `ownerEmail`, resolves via `UserRepository.findByEmail`, 400 on missing/unknown — `apps/__tests__/web/api/bot-start.test.ts`.
- [ ] 2.4 `apps/worker/src/integrations/calendar/types.ts`: `CalendarMeetingEvent` gains `ownerUserId`, `participantEmails`.
- [ ] 2.5 RED+GREEN: `GoogleCalendarProvider.ts` stamps `ownerUserId` per OAuth user, maps `event.attendees` — `apps/__tests__/worker/calendar/google-calendar-provider.test.ts`.
- [ ] 2.6 RED+GREEN: `autoJoinService.ts` threads `ownerId`/`participantEmails` on primary path, skips+logs on ownerless env-fallback — `apps/__tests__/worker/shared/auto-join-service.test.ts`.

## Phase 3: Ownership-Scoped Visibility

- [ ] 3.1 RED+GREEN: `WebMeetingRepository.ts` — owner-or-live-grant WHERE, joined to `authorized_accounts.isActive`, no role bypass — `apps/__tests__/web/repositories/web-meeting-repository.test.ts`.
- [ ] 3.2 Thread `session.user.id` into meeting list/detail callers under `apps/web/src/app/(main)/`.

## Phase 4: Access Grants

- [x] 4.1 Extract `shareTtl.ts` (`DEFAULT_SHARE_TTL_OPTIONS_MINUTES` + helpers) out of `meetingShareService.ts`.
- [x] 4.2 RED+GREEN: `MeetingAccessGrantRepository.ts` (create/findById/listByMeetingId/findLiveGrant/revokeById) — `apps/__tests__/shared/repositories/meeting-access-grant-repository.test.ts`.
- [x] 4.3 RED+GREEN: `meetingAccessGrantService.ts` (`createGrant`/`listGrantsByMeetingId`/`revokeGrant`, `callerId === meeting.ownerId`) — `apps/__tests__/web/services/meeting-access-grant-service.test.ts`.
- [x] 4.4 `app/actions/grants.ts`: `createGrantAction`/`revokeGrantAction` (owner-only).

## Phase 5: Share Authorization Retrofit

- [ ] 5.1 RED+GREEN: `meetingShareService.ts` — `createShare` requires `callerId === meeting.ownerId`, drops `"public"` branch, resolve-then-fallback signed URL — `apps/__tests__/web/services/meeting-share-service.test.ts`.
- [ ] 5.2 `app/actions/shares.ts`: `createShareAction` resolves session, passes `callerId`.

## Phase 6: Remove Public Share Type + Participant Suggestions

- [ ] 6.1 Drop `"public"`: `sharing/types.ts`, `SharingProvider.ts`, `SharingProviderFactory.ts`; delete `PublicSharingProvider.ts`.
- [ ] 6.2 `MeetingDetailsView.tsx`: remove public option/state/rendering; add per-participant suggestion list (from `participantEmails`) with individual confirm-to-grant, manual entry for ad-hoc meetings (UI — manual/integration validation, exempt per AGENTS.md).
- [ ] 6.3 RED+GREEN: `integrations/chat/tools/definitions.ts` — `enqueue_meeting` sets `ownerId` from session; `manage_meeting_share` drops `"public"`, routes create/revoke through `MeetingShareService`/`MeetingAccessGrantService` — `apps/__tests__/web/integrations/chat-tools-definitions.test.ts`.

## Phase 7: Recording Storage Key Naming

- [ ] 7.1 RED+GREEN: `meetingProvider.ts` — `sanitizeMeetingNameForStorageKey`, `buildNamedRecordingStorageKey` — `apps/__tests__/shared/meeting-provider.test.ts`.
- [ ] 7.2 RED+GREEN: `meetingWorkerService.ts` persists `recordingStorageKey` at upload — extend its test.
- [ ] 7.3 RED+GREEN: resolve-then-fallback (`recordingStorageKey ?? buildRecordingStorageKey()`) in `meetingRecoveryService.ts`, `DeleteMeetingCommand.ts`, `api/meetings/[id]/route.ts`, `api/v1/extension/meetings/[id]/route.ts`, `(main)/meeting/[id]/page.tsx` — extend each file's existing test.

## Phase 8: Verification

- [ ] 8.1 `bun test apps/__tests__` green across all new/modified suites.
- [ ] 8.2 `bun run lint && bun run typecheck && bun run build:web`.
- [ ] 8.3 Manual walkthrough: public-share removal, per-participant suggestions, ad-hoc no-suggestions, deactivated-owner lockout.
