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
    const body = (await req.json()) as { email?: string; code?: string };
    if (!body.email?.trim() || !body.code?.trim()) {
      return NextResponse.json({ error: "Email and code are required" }, { status: 400 });
    }

    const result = await MeetingShareService.verifyRestrictedAccess(token, body.email, body.code, {
      ipAddress: getRequestIp(req),
      userAgent: getRequestUserAgent(req),
    });

    if (result.status === "not_found") {
      return NextResponse.json({ error: "Share not found" }, { status: 404 });
    }

    if (result.status === "denied") {
      return NextResponse.json({ error: "Invalid email or code" }, { status: 401 });
    }

    return NextResponse.json({ status: "ok", shareType: "restricted_email", meeting: result.meeting });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown verification error";
    const status = message.includes("Too many") ? 429 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
