import { NextRequest, NextResponse } from "next/server";
import { assertPrivateApiAuthorized } from "@/services/privateApiAuth";
import { MeetingShareService } from "@/services/meetingShareService";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ meetingId: string }> }
) {
  const unauthorized = assertPrivateApiAuthorized(req);
  if (unauthorized) return unauthorized;

  const { meetingId } = await params;
  if (!meetingId) {
    return NextResponse.json({ error: "meetingId is required" }, { status: 400 });
  }

  try {
    const shares = await MeetingShareService.listSharesByMeetingId(meetingId);
    return NextResponse.json({
      shares,
      ttlOptionsMinutes: MeetingShareService.getTtlOptionsMinutes(),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error listing shares";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
