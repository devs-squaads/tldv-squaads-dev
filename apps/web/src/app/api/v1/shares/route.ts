import { NextRequest, NextResponse } from "next/server";
import { assertPrivateApiAuthorized } from "@/services/privateApiAuth";
import { MeetingShareService } from "@/services/meetingShareService";
import type { CreateShareInput } from "@/integrations/sharing/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const unauthorized = assertPrivateApiAuthorized(req);
  if (unauthorized) return unauthorized;

  return NextResponse.json({
    ttlOptionsMinutes: MeetingShareService.getTtlOptionsMinutes(),
  });
}

export async function POST(req: NextRequest) {
  const unauthorized = assertPrivateApiAuthorized(req);
  if (unauthorized) return unauthorized;

  try {
    const body = (await req.json()) as Partial<CreateShareInput>;

    if (!body.meetingId) {
      return NextResponse.json({ error: "meetingId is required" }, { status: 400 });
    }
    if (!body.shareType || body.shareType !== "restricted_email") {
      return NextResponse.json({ error: "shareType must be restricted_email" }, { status: 400 });
    }

    const result = await MeetingShareService.createShare({
      meetingId: body.meetingId,
      shareType: body.shareType,
      recipientEmail: body.recipientEmail,
      ttlMinutes: body.ttlMinutes,
      noExpiry: body.noExpiry,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error creating share";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
