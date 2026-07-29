import { NextRequest, NextResponse } from "next/server";
import { assertExtensionAccessAuthorized } from "@/services/extensionTokens";
import { MeetingRepository } from "@meeting-bot/shared/repositories/MeetingRepository";
import {
  EXTENSION_TRACKABLE_FRESHNESS_MS,
  EXTENSION_TRACKABLE_STATUSES,
} from "@meeting-bot/shared/domain/meetingStatus";
import { normalizeMeetingUrl } from "@meeting-bot/shared/meetingProvider";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = assertExtensionAccessAuthorized(req);
  if (!auth.ok) return auth.response;

  const url = req.nextUrl.searchParams.get("url");
  const provider = req.nextUrl.searchParams.get("provider") || undefined;

  if (!url) {
    return NextResponse.json({ error: "url query param is required" }, { status: 400 });
  }

  const normalizedUrl = normalizeMeetingUrl(url, provider);
  const createdAfter = new Date(Date.now() - EXTENSION_TRACKABLE_FRESHNESS_MS);
  const meeting = await MeetingRepository.findTrackableByUrlAndOwner(
    normalizedUrl,
    auth.payload.userId,
    createdAfter,
  );

  if (!meeting) {
    return NextResponse.json({ active: false, meeting: null, normalizedUrl });
  }

  return NextResponse.json({
    active: EXTENSION_TRACKABLE_STATUSES.includes(meeting.status),
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
