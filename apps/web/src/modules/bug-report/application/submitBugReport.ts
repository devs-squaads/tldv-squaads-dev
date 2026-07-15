import type { SupportDiagnostic, SupportNotification, SupportProvider } from "@/integrations/support/SupportProvider";
import type { PiiRedactionHooks } from "@/modules/chat/http/trustBoundary";

const MAX_MESSAGE_LENGTH = 2000;
export const BUG_REPORT_RATE_LIMIT = 5;
export const BUG_REPORT_RATE_WINDOW_MS = 10 * 60 * 1000;

export interface BugReportMeetingSnapshot { id: string; organizerEmail?: string | null; status: string; errorMessage: string | null; sourceProvider: string | null; startsAt: Date | null; endsAt: Date | null; }
export interface SubmitBugReportDeps { findMeetingById: (id: string) => Promise<BugReportMeetingSnapshot | null>; provider: SupportProvider; redactText: (text: string) => string; consumeRateLimit: (key: string, limit: number, windowMs: number) => boolean; }
export type SubmitBugReportResult = { status: "ok" } | { status: "unauthorized" } | { status: "invalid"; reason: string } | { status: "not-found" } | { status: "rate-limited" } | { status: "delivery-failed" };

export function requireRedactText(hooks: PiiRedactionHooks): (text: string) => string {
  if (!hooks.redactText) throw new Error("Bug report PII redaction hook is not configured");
  return hooks.redactText;
}

export async function submitBugReport(input: { userId: string | null; userEmail?: string | null; message: unknown; meetingId?: string }, deps: SubmitBugReportDeps): Promise<SubmitBugReportResult> {
  if (!input.userId) return { status: "unauthorized" };
  if (typeof input.message !== "string" || !input.message.trim()) return { status: "invalid", reason: "message is required" };
  const message = input.message.trim().slice(0, MAX_MESSAGE_LENGTH);
  if (!deps.consumeRateLimit(`bug-report:${input.userId}`, BUG_REPORT_RATE_LIMIT, BUG_REPORT_RATE_WINDOW_MS)) return { status: "rate-limited" };
  let diagnostic: SupportDiagnostic = { kind: "none" };
  if (input.meetingId) {
    const meeting = await deps.findMeetingById(input.meetingId);
    if (!meeting) return { status: "not-found" };
    if (!input.userEmail || !meeting.organizerEmail || meeting.organizerEmail.toLowerCase() !== input.userEmail.toLowerCase()) return { status: "not-found" };
    diagnostic = { kind: "meeting", meetingId: meeting.id, status: meeting.status, errorMessage: meeting.errorMessage ? deps.redactText(meeting.errorMessage) : null, sourceProvider: meeting.sourceProvider, startsAt: meeting.startsAt, endsAt: meeting.endsAt };
  }
  const notification: SupportNotification = { reporterId: input.userId, message: deps.redactText(message), diagnostic };
  try { await deps.provider.deliver(notification); } catch { return { status: "delivery-failed" }; }
  return { status: "ok" };
}

export function mapSubmitBugReportResultToResponse(result: SubmitBugReportResult): { statusCode: number; body: { ok: true } | { error: string } } {
  switch (result.status) {
    case "ok": return { statusCode: 200, body: { ok: true } };
    case "unauthorized": return { statusCode: 401, body: { error: "Unauthorized" } };
    case "invalid": return { statusCode: 400, body: { error: "Invalid bug report" } };
    case "not-found": return { statusCode: 404, body: { error: "Meeting not found" } };
    case "rate-limited": return { statusCode: 429, body: { error: "Too many bug reports, try again later" } };
    case "delivery-failed": return { statusCode: 503, body: { error: "Unable to submit bug report" } };
  }
}
