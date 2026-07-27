# Tasks: Member-Share Admin Approval + Real SMTP Email Provider

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~1400-1900 (new table+repo+service+provider+3 new components+1 large modified component+7 wiring files+~9 test files) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 → PR2 → PR3 → PR5 → PR6, with PR4 (SMTP) branching parallel off PR1 |
| Delivery strategy | ask-on-risk |
| Chain strategy | feature-branch-chain (recommended, pending confirmation) |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | Schema + migration + `MeetingShareRequestRepository` + `requireCaller()` | PR1 (base=tracker) | `bun test apps/__tests__/shared/repositories/meeting-share-request-repository.test.ts apps/__tests__/web/lib/session-caller.test.ts` | `bun run infra:reset` (migration applies, unique-index race) | Revert schema.ts additions, migration file, repository, sessionCaller.ts |
| 2 | `ShareRequestService` full lifecycle | PR2 (base=PR1) | `bun test apps/__tests__/web/services/share-request-service.test.ts` | N/A — pure service logic, mocked repo | Revert shareRequestService.ts + test |
| 3 | Role branch in existing services + actions wiring | PR3 (base=PR2) | `bun test apps/__tests__/web/services/meeting-share-service.test.ts apps/__tests__/web/services/meeting-access-grant-service.test.ts` | `bun run dev:web`: member Owner share → pending row, no email | Revert callerRole params, actions/shares.ts, grants.ts, shareRequests.ts |
| 4 | `SmtpEmailProvider` + factory + package.json | PR4 (base=PR1, parallel to PR2/3) | `bun test apps/__tests__/web/integrations/smtp-email-provider.test.ts` | `bun run dev:web` with real SMTP env, send one test email | Revert SmtpEmailProvider.ts, factory case, package.json dep |
| 5 | AppHeader + PendingRequestsBell + admin page | PR5 (base=PR3) | Manual only (UI, no test file per Testing Strategy) | `bun run dev:web`: admin sees bell+badge, member does not, page redirects member | Revert AppHeader.tsx, PendingRequestsBell.tsx, admin page, AdminShareRequestsView.tsx, 3 page swaps |
| 6 | `MeetingDetailsView.tsx` 3 modes + access-type/days + "Solicitudes y accesos" + chat tool + README | PR6 (base=PR5) | Manual only (UI) | `bun run dev:web` full walkthrough: share all/subset/email, approve/reject, passive discovery | Revert MeetingDetailsView.tsx diff, definitions.ts, README.md |

## Phase 1: Schema & Repository
- [x] 1.1 `packages/shared/src/db/schema.ts`: add `shareRequestStatusEnum`, `shareRequestAccessTypeEnum`, `meetingShareRequests` table (CHECK grantee XOR email, 2 partial unique indexes), `meetingShares.singleUse` — per plan.md Schema section.
- [x] 1.2 `drizzle/NNNN_meeting_share_requests.sql`: additive migration matching 1.1.
- [x] 1.3 RED+GREEN `packages/shared/src/repositories/MeetingShareRequestRepository.ts` (create/findById/listPending/countPending/listByMeetingId/resolve/cancel). Test `meeting-share-request-repository.test.ts` per plan.md Testing Strategy.

## Phase 2: `requireCaller()` Helper
- [x] 2.1 RED+GREEN `apps/web/src/lib/sessionCaller.ts`. Test `session-caller.test.ts` per plan.md Testing Strategy.
- [x] 2.2 Replace both duplicated `requireCallerId()` in `app/actions/shares.ts` and `grants.ts` with `requireCaller()`.

## Phase 3: `ShareRequestService` (TDD)
- [x] 3.1 RED+GREEN `apps/web/src/services/shareRequestService.ts` (contract per plan.md Interfaces). Test `share-request-service.test.ts` — all cases per plan.md Testing Strategy row (includes admin-gate assertions, no separate test needed).

## Phase 4: Role Branch in Existing Services
- [x] 4.1 RED+GREEN `meetingShareService.ts`: `callerRole?` guard (member throws), `singleUse` persist + revoke-on-first-verify in `verifyRestrictedAccess`. Extend `meeting-share-service.test.ts` per plan.md.
- [x] 4.2 RED+GREEN `meetingAccessGrantService.ts`: `callerRole?` guard (member throws), accessType→TTL mapping (permanent→noExpiry, temporary→days*1440). Extend `meeting-access-grant-service.test.ts` per plan.md.
- [x] 4.3 `integrations/sharing/types.ts`: `CreateShareInput.singleUse?: boolean`.
- [x] 4.4 `app/actions/shares.ts`, `grants.ts`: member Owner → `ShareRequestService`, admin Owner → direct create; revoke stays direct for both roles.
- [x] 4.5 `app/actions/shareRequests.ts` (new): create/cancel/approve/reject/listByMeeting/listPending actions.

## Phase 5: `SmtpEmailProvider` (TDD)
- [ ] 5.1 `apps/web/package.json`: add `nodemailer` + `@types/nodemailer` (dev).
- [ ] 5.2 RED+GREEN `integrations/email/providers/SmtpEmailProvider.ts`: injectable transport factory; complete config → send; incomplete+production → throw (blocks send); incomplete+dev → console fallback. Test `smtp-email-provider.test.ts` per plan.md.
- [ ] 5.3 `integrations/email/EmailProviderFactory.ts`: add `"smtp"` case.

## Phase 6: UI Wiring
- [ ] 6.1 `components/AppHeader.tsx` (new): extract shared header from the 3 duplicated inline headers.
- [ ] 6.2 `components/PendingRequestsBell.tsx` (new): admin-only, badge = `countPending()`, links to admin page.
- [ ] 6.3 Swap headers in `app/(main)/page.tsx`, `settings/page.tsx`, `meeting/[id]/page.tsx` for `AppHeader`; meeting page also fetches grants + share requests into props.
- [ ] 6.4 `app/(main)/admin/share-requests/page.tsx` (new): `force-dynamic`; no session → `/login`; non-admin → `/`.
- [ ] 6.5 `components/AdminShareRequestsView.tsx` (new): pending list, approve/reject.
- [ ] 6.6 `components/MeetingDetailsView.tsx`: 3 recipient modes (all/subset/email), access-type + day controls, member pending/cancel state, new "Solicitudes y accesos" section (all-statuses requests + grants list).

## Phase 7: Chat Tool Role-Awareness
- [ ] 7.1 `integrations/chat/tools/definitions.ts`: `manage_meeting_share` passes caller role; member gets "requires admin approval" error.

## Phase 8: Docs
- [ ] 8.1 `README.md`: add `SMTP_HOST/PORT/USER/PASS/FROM` + `EMAIL_PROVIDER=smtp` row to env table (only real sync target, no `.env*.example` files exist).

## Phase 9: Verification
- [ ] 9.1 `bun test apps/__tests__` green (all new/extended suites from Phases 1-5).
- [ ] 9.2 `bun run lint && bun run typecheck && bun run build:web`.
- [ ] 9.3 Manual walkthrough (UI-visual exempt per AGENTS.md, per plan.md Testing Strategy "Exempt" row): bell badge count, admin-only page guard, 3 recipient modes, passive rejection surfaces (both recipient paths), real SMTP send with configured env.
