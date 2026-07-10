import { NextRequest, NextResponse } from "next/server";
import { MeetingShareService } from "@/services/meetingShareService";
import { getRequestIp, getRequestUserAgent } from "@/services/requestMeta";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!token) {
    return NextResponse.json({ error: "Token is required" }, { status: 400 });
  }

  try {
    const body = (await req.json()) as { email?: string };
    if (!body.email?.trim()) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    await MeetingShareService.requestRestrictedAccess(token, body.email, {
      ipAddress: getRequestIp(req),
      userAgent: getRequestUserAgent(req),
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown access request error";
    const status = message.includes("Too many") ? 429 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
