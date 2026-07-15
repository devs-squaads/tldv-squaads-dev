import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { MeetingRepository } from "@meeting-bot/shared/repositories/MeetingRepository";
import { SupportProviderFactory } from "@/integrations/support/SupportProviderFactory";
import { consumeRateLimit } from "@/integrations/sharing/rateLimit";
import { createSupportPiiRedactionHooks } from "@/modules/chat/support/piiRedaction";
import { createChatRequestContext, jsonWithChatRequestContext } from "@/modules/chat/http/requestContext";
import { mapSubmitBugReportResultToResponse, requireRedactText, submitBugReport } from "@/modules/bug-report/application/submitBugReport";
export const dynamic = "force-dynamic";
const redactText = requireRedactText(createSupportPiiRedactionHooks());
export async function POST(request: NextRequest) {
  const context = createChatRequestContext(request, "bugReport"); const session = await getServerSession(authOptions); let body: { message?: unknown; meetingId?: unknown } = {};
  try { body = await request.json(); } catch { /* invalid body maps to a safe 400 */ }
  const result = await submitBugReport({ userId: session?.user?.id ?? null, userEmail: session?.user?.email, message: body.message, meetingId: typeof body.meetingId === "string" ? body.meetingId : undefined }, { findMeetingById: async (id) => { const meeting = await MeetingRepository.findById(id); return meeting ? { id: meeting.id, organizerEmail: meeting.organizerEmail, status: meeting.status, errorMessage: meeting.errorMessage, sourceProvider: meeting.sourceProvider, startsAt: meeting.startsAt, endsAt: meeting.endsAt } : null; }, provider: SupportProviderFactory.getProvider(), redactText, consumeRateLimit });
  const response = mapSubmitBugReportResultToResponse(result); return jsonWithChatRequestContext(context, response.body, { status: response.statusCode });
}
