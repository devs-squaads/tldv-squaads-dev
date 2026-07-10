import { NextRequest, NextResponse } from "next/server";
import { assertPrivateApiAuthorized } from "@/services/privateApiAuth";
import { MeetingShareService } from "@/services/meetingShareService";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ shareId: string }> }
) {
  const unauthorized = assertPrivateApiAuthorized(req);
  if (unauthorized) return unauthorized;

  const { shareId } = await params;
  if (!shareId) {
    return NextResponse.json({ error: "shareId is required" }, { status: 400 });
  }

  let payload: { ttlMinutes?: number; noExpiry?: boolean } = {};
  try {
    payload = await req.json();
  } catch {
    payload = {};
  }

  try {
    const result = await MeetingShareService.renewShareAccess(shareId, {
      ttlMinutes: payload.ttlMinutes,
      noExpiry: payload.noExpiry,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error renewing share";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
