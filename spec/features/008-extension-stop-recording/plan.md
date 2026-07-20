# 008 · Extension Stop-Recording Action — Plan

_How `spec.md` gets implemented. Must respect `constitution/`. Reuses INVITE_BOT's pattern 1:1 — no new
abstractions, no new `MeetingStatus` value (see `docs/adr/0004-stop-recording-reuses-completed-status.md`)._

## Approach

Add a nullable `stopRequestedAt` timestamp to `meetings` (same convention as `startsAt`/`endsAt`). A new
authenticated web route sets it via the existing `MeetingRepository.updateById` — no new repository method
needed. The worker's already-ticking 2s poll loop inside `OnlineMeetingProvider.record()` gains one more
check per tick: if `stopRequestedAt` is set, call the existing hardened `stopRecording()` closure (graceful
ffmpeg stop, SIGKILL fallback). The resulting `recording → completed` transition flows through unchanged and
reaches the widget via the existing 007 status-sync Port broadcast — no new IPC.

On the extension side, `STOP_BOT` is added as a stateless `sendMessage` command mirroring `INVITE_BOT`
exactly (service-worker case → api-client function → web route), and the widget gets a small state-machine
extension: a dedicated stop control, visible only in `recording`, gated by a client-side 5s guard computed
from a locally-tracked timestamp (no new backend data), a confirm step, and an optimistic "stopping…" state.

## Implementation

1. **`stopRequestedAt` column** — `packages/shared/src/db/schema.ts`, in the `meetings` table, right after
   `endsAt`:
   ```ts
   stopRequestedAt: timestamp("stop_requested_at", { withTimezone: true }),
   ```
   Nullable, no default — same shape as `startsAt`/`endsAt`. Requires a Drizzle migration (additive,
   reversible by dropping the column).

2. **No new repository method** — `MeetingRepository.updateById` (`packages/shared/src/repositories/MeetingRepository.ts:56`)
   already accepts `Partial<Omit<MeetingInsert, "id">>`, which includes `stopRequestedAt` once the schema
   change lands. The stop route calls it directly, same as every other status-mutating route in the codebase.

3. **New route** `apps/web/src/app/api/v1/extension/meetings/[id]/stop/route.ts` — mirrors
   `apps/web/src/app/api/v1/extension/meetings/[id]/route.ts` (`GET`) for auth/param handling, and
   `apps/web/src/app/api/v1/extension/bot/start/route.ts` for the `assertExtensionAccessAuthorized` gate:
   ```ts
   import { NextRequest, NextResponse } from "next/server";
   import { assertExtensionAccessAuthorized } from "@/services/extensionTokens";
   import { MeetingRepository } from "@meeting-bot/shared/repositories/MeetingRepository";

   export const dynamic = "force-dynamic";

   export async function POST(
     request: NextRequest,
     { params }: { params: Promise<{ id: string }> },
   ) {
     const auth = assertExtensionAccessAuthorized(request);
     if (!auth.ok) return auth.response;

     const { id } = await params;
     if (!id) {
       return NextResponse.json({ error: "Meeting ID is required" }, { status: 400 });
     }

     const meeting = await MeetingRepository.findById(id);
     if (!meeting) {
       return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
     }

     if (meeting.status !== "recording") {
       return NextResponse.json({ error: "Meeting is not currently recording" }, { status: 409 });
     }

     await MeetingRepository.updateById(id, { stopRequestedAt: new Date(), updatedAt: new Date() });
     return NextResponse.json({ ok: true });
   }
   ```
   Same trust level as `bot/start` (valid Extension Access Token for the origin), no ownership check —
   per ADR-0004. The `status === "recording"` guard rejects stop requests outside the only status this
   ADR makes meaningful, but the DB write itself stays idempotent (calling it twice while recording just
   re-sets the same timestamp).

4. **`STOP_BOT` message contract** — `apps/extension/src/shared/types.ts`, mirroring `INVITE_BOT`:
   ```ts
   export type RuntimeMessage =
     | ...
     | { type: "STOP_BOT"; meetingId: string }
     | ...;
   ```
   `RuntimeResponse` needs no new variant — the existing bare `{ ok: true }` covers it (stop has no payload
   to return, unlike invite's `meetingId`).

5. **`stopBot()` in `apps/extension/src/background/api-client.ts`** — mirrors `inviteBot()`, using the same
   `apiFetch` + `resolveTransport` path-rewrite convention as `pollMeeting()` (`/api/meetings/...` rewrites
   to `/api/v1/extension/meetings/...` under linked-session auth):
   ```ts
   export async function stopBot(meetingId: string): Promise<void> {
     logInfo("stopBot", { meetingId });
     await apiFetch<{ ok: boolean }>(`/api/meetings/${encodeURIComponent(meetingId)}/stop`, {
       method: "POST",
     });
   }
   ```

6. **Service-worker case** — `apps/extension/src/background/service-worker.ts`, in `handleMessage`'s switch,
   mirroring the `INVITE_BOT` case:
   ```ts
   case "STOP_BOT":
     await stopBot(message.meetingId);
     return { ok: true };
   ```
   Add `stopBot` to the existing `import { checkStatus, connectExtension, inviteBot, pollMeeting } from "./api-client";` line.

7. **Worker poll-tick check** — `apps/worker/src/bot/providers/OnlineMeetingProvider.ts`, inside `record()`'s
   existing `pollInterval` (line ~234-253, same tick that already runs `imAlone()` and the max-duration
   check). `record()` gains a `meetingId: string` parameter, threaded from `apps/worker/src/bot/index.ts`
   (`meet.record(outputPath, duration, meetingId)`) and from there `BotOptions` in `apps/worker/src/bot/index.ts`
   (`startBot`'s existing caller, `processMeetingAsync` in `apps/worker/src/services/meetingWorkerService.ts`,
   already has `meetingId` in scope). Inside the tick:
   ```ts
   if (totalTime < 15_000) return; // existing UI-load skip window

   const meeting = await MeetingRepository.findById(meetingId);
   if (meeting?.stopRequestedAt) {
     console.log('[OnlineMeetingProvider] Stop requested, stopping recording');
     await stopRecording();
     return;
   }

   if (await this.imAlone()) { ... } // existing
   if (totalTime > maxMeetingTime) { ... } // existing
   ```
   Requires importing `MeetingRepository` from `@meeting-bot/shared/repositories/MeetingRepository` into
   `OnlineMeetingProvider.ts` — an additive worker→shared dependency, consistent with every other worker
   service already doing this (`meetingWorkerService.ts`, `meetingRecoveryService.ts`). One extra `findById`
   DB read per 2s tick during `recording` — same order of magnitude as the existing `imAlone()` DOM check,
   not a new class of cost.

8. **Widget state machine** — `apps/extension/src/content/widget.ts`:
   - Extend `WidgetState` with two new variants, mirroring the existing `{type:"active",...}` shape:
     ```ts
     type WidgetState =
       | ...
       | { type: "active"; meetingId: string; status: MeetingStatus }
       | { type: "stop_confirm"; meetingId: string }
       | { type: "stopping"; meetingId: string }
       | { type: "error"; message: string };
     ```
   - Extend `WidgetStateType` in `apps/extension/src/shared/status-sync.ts` with `"stop_confirm" | "stopping"`
     so the existing `diff()` state machine treats them as distinct full-render types (no `status` field
     variance to track within them — `toRenderState()` already handles any type generically via
     `{ type: state.type, status: null }`, no change needed there).
   - Track a client-side "entered recording" timestamp — **not** a new backend value, computed purely from
     the status transitions the widget already receives over the 007 Port:
     ```ts
     private recordingEnteredAt: number | null = null;
     private stopGuardTimer: ReturnType<typeof setTimeout> | null = null;
     const MIN_STOP_DURATION_MS = 5000; // placeholder, tune later
     ```
     Called from `setState()` (the single mutation point both `applyPortUpdate()` and `invite()` funnel
     through) before diffing:
     ```ts
     private trackRecordingEntry(next: WidgetState) {
       const inRecordingFlow =
         (next.type === "active" && next.status === "recording") ||
         next.type === "stop_confirm" ||
         next.type === "stopping";

       if (!inRecordingFlow) {
         this.recordingEnteredAt = null;
         this.clearStopGuardTimer();
         return;
       }
       if (this.recordingEnteredAt === null) {
         this.recordingEnteredAt = Date.now();
         this.scheduleStopGuardExpiry(); // setTimeout(MIN_STOP_DURATION_MS) -> this.mount() to flip disabled
       }
     }

     private stopGuardElapsed(): boolean {
       return this.recordingEnteredAt !== null && Date.now() - this.recordingEnteredAt >= MIN_STOP_DURATION_MS;
     }
     ```
     `scheduleStopGuardExpiry()` re-mounts (full re-render) once the guard window elapses so the disabled
     attribute flips without waiting for the next Port broadcast; `clearStopGuardTimer()` is also called
     from `destroy()`.
   - `mount()` gains a dedicated `#squaads-stop-btn` (peer to `#squaads-primary-btn`, same construction
     pattern as `#squaads-dismiss-btn`) — kept separate from the primary button so `patchStatus()`'s surgical
     status patch (which rewrites the primary button's label/color to `STATUS_LABELS[status]`) never fights
     with the stop control's own label/disabled state:
     ```ts
     let stopVisible = false;
     let stopLabel = "Stop";
     let stopDisabled = true;
     let stopHandler: (() => void) | null = null;

     if (this.state.type === "active" && this.state.status === "recording") {
       stopVisible = true;
       stopDisabled = !this.stopGuardElapsed();
       stopHandler = stopDisabled ? null : () => this.confirmStopPrompt();
     }
     if (this.state.type === "stop_confirm") {
       stopVisible = true;
       stopLabel = "Confirm stop?";
       stopHandler = () => void this.stop();
     }
     if (this.state.type === "stopping") {
       stopVisible = true;
       stopLabel = "Stopping…";
       stopDisabled = true;
     }
     ```
     Rendered only in the expanded template (not the collapsed pill) — visibility rule "recording only" is
     already satisfied since `stopVisible` is false for every other state.
   - Interaction handlers:
     ```ts
     private confirmStopPrompt() {
       if (this.isInactive()) return;
       if (this.state.type !== "active" || this.state.status !== "recording") return;
       this.setState({ type: "stop_confirm", meetingId: this.state.meetingId });
     }

     private async stop(): Promise<void> {
       if (this.isInactive()) return;
       if (this.state.type !== "stop_confirm") return;
       const { meetingId } = this.state;
       this.setState({ type: "stopping", meetingId }); // disables the control immediately (no handler wired)
       const res = await send({ type: "STOP_BOT", meetingId });
       if (this.isInactive()) return;
       if (!res.ok) {
         this.setState({ type: "error", message: (res as { ok: false; error: string }).error });
       }
       // On success: stay in "stopping" until applyPortUpdate() receives the
       // resulting `completed` broadcast — no new plumbing, reuses 007's Port.
     }
     ```
   - "Disable on click" is structural, not a flag: `stopHandler` is only wired when `stopDisabled` is
     false, and the `"stopping"` branch never sets `stopHandler`, so a second click has nothing to bind to.

9. **Regenerate the internal ZIP** (`bun run extension:build`) and add the `stopRequestedAt` migration to
   whatever migration tooling `packages/shared/src/db` already uses.

## Decisions

- **Reuse `MeetingRepository.updateById`, no new repository method** — the update is a single nullable
  column write, exactly the shape `updateById` already exists for. A dedicated `requestStop()` method would
  be one line wrapping another line — rejected as unrequested abstraction.
- **Dedicated `#squaads-stop-btn` instead of repurposing `#squaads-primary-btn`** — the primary button's
  label/color is already owned by the surgical `patchStatus()` path (driven by `STATUS_LABELS[status]`);
  overloading it with stop semantics would mean patchStatus and the stop-state renderer fighting over the
  same DOM node's text on every status broadcast during `recording`.
- **5s guard computed client-side from the widget's own state transitions, not a new backend field** — the
  proposal explicitly said not to invent a new backend timestamp for this. The widget already learns
  `status === "recording"` from the existing Port broadcast; the "when did I enter recording" instant is a
  pure client-side derivation from that, cheap and with no new network shape.
- **Server-side `status !== "recording"` guard (409) on the stop route** — not explicitly required by the
  proposal but consistent with ADR-0004 ("STOP_BOT is only meaningful while status === recording"); this is
  the smallest possible enforcement (one extra `if`) of an invariant the ADR already states, not new scope.
- **No legacy (`API_ROUTE_SECRET`) `/api/meetings/[id]/stop` route** — `stopBot()` follows the same
  `/api/meetings/...` → `/api/v1/extension/meetings/...` path-rewrite convention `pollMeeting()` already
  uses. Under `legacy-token` auth mode the rewrite doesn't happen and the call would 404. This mirrors the
  proposal's exact affected-file list (only the extension route is new) — legacy-token extension users don't
  get stop support in this slice; same category of gap as the pre-existing no-ownership check, not
  introduced debt.
- **One extra `MeetingRepository.findById` per 2s tick during `recording`, not a push/webhook mechanism** —
  per ADR-0004's rejected "Approach 2" (live/synchronous stop via worker internal API), DB-flag + poll is
  the chosen mechanism. The existing tick already does a DOM check (`imAlone()`) every 2s for the entire
  recording duration; one more read is the same order of cost, not a new pattern.

## Risks

- **Up to ~2s stop latency** (worker poll cadence) — inherited from the ADR, mitigated by the optimistic
  "stopping…" widget state covering the gap.
- **`stopRequestedAt` migration must land before the route/worker check deploy** — sequencing risk if
  deployed out of order (route would fail to compile against the old schema type, or the worker check would
  read `undefined` against an old DB). Standard additive-migration-first rollout, no special handling needed.
- **`OnlineMeetingProvider.ts` gains a new worker→shared import** (`MeetingRepository`) — no test currently
  covers `record()` (codegraph explore flagged "no covering tests found" on both `OnlineMeetingProvider` and
  `record`); per this project's TDD rule, the new stop-check branch needs its own test coverage added in
  `apps/__tests__/worker/...` even though the surrounding method has none today — do not let the untested
  legacy code exempt the new logic.
- **5s guard is a client-side timer, not enforced server-side** — a user could in principle send `STOP_BOT`
  before 5s by bypassing the widget (e.g. directly via `chrome.runtime.sendMessage`); the proposal scoped
  this as a UX guard against accidental clicks, not a security boundary, so this is accepted as-is.

## Dependencies

None — reuses `assertExtensionAccessAuthorized`, `MeetingRepository.updateById`, the existing
`stopRecording()` closure, and the 007 status-sync Port broadcast. No new IPC, no new `MeetingStatus` value.
