import { NextRequest, NextResponse } from "next/server";
import { MeetingRepository } from "@meeting-bot/shared/repositories/MeetingRepository";
import { ACTIVE_PROCESSING_STATUSES } from "@meeting-bot/shared/domain/meetingStatus";
import { normalizeMeetingUrl } from "@meeting-bot/shared/meetingProvider";

export const dynamic = "force-dynamic";

const DEDUP_WINDOW_MS = 10 * 60 * 1000;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("Authorization");
  const secret = process.env.API_ROUTE_SECRET;

  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = req.nextUrl.searchParams.get("url");
  const provider = req.nextUrl.searchParams.get("provider") || undefined;

  if (!url) {
    return NextResponse.json({ error: "url query param is required" }, { status: 400 });
  }

  const normalizedUrl = normalizeMeetingUrl(url, provider);
  const from = new Date(Date.now() - DEDUP_WINDOW_MS);
  const meeting = await MeetingRepository.findActiveByUrlCreatedAfter(normalizedUrl, from);

  if (!meeting) {
    return NextResponse.json({ active: false, meeting: null, normalizedUrl });
  }

  return NextResponse.json({
    active: ACTIVE_PROCESSING_STATUSES.includes(meeting.status),
    normalizedUrl,
    meeting: {
      id: meeting.id,
      url: meeting.url,
      status: meeting.status,
      botName: meeting.botName,
      errorMessage: meeting.errorMessage,
      createdAt: meeting.createdAt,
      updatedAt: meeting.updatedAt,
    },
  });
}
