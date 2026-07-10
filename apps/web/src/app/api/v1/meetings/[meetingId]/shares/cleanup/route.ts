import { NextRequest, NextResponse } from "next/server";
import { assertPrivateApiAuthorized } from "@/services/privateApiAuth";
import { MeetingShareService } from "@/services/meetingShareService";

export const dynamic = "force-dynamic";

export async function POST(
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
    const result = await MeetingShareService.clearInactiveShares(meetingId);
    return NextResponse.json({ success: true, ...result });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error clearing inactive shares";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
