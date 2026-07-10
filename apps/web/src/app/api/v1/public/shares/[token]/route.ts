import { NextRequest, NextResponse } from "next/server";
import { MeetingShareService } from "@/services/meetingShareService";
import { getRequestIp, getRequestUserAgent } from "@/services/requestMeta";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!token) {
    return NextResponse.json({ error: "Token is required" }, { status: 400 });
  }

  const result = await MeetingShareService.resolvePublicShare(token, {
    ipAddress: getRequestIp(req),
    userAgent: getRequestUserAgent(req),
  });

  if (result.status === "not_found") {
    return NextResponse.json({ error: "Share not found" }, { status: 404 });
  }

  return NextResponse.json(result);
}
