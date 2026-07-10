import { NextRequest, NextResponse } from "next/server";
import { assertExtensionAccessAuthorized } from "@/services/extensionTokens";
import { MeetingRepository } from "@meeting-bot/shared/repositories/MeetingRepository";
import { buildRecordingStorageKey } from "@meeting-bot/shared/meetingProvider";
import { StorageProviderFactory } from "@meeting-bot/shared/integrations/storage/StorageProviderFactory";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = assertExtensionAccessAuthorized(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: "Meeting ID is required" }, { status: 400 });
  }

  const meeting = await MeetingRepository.findById(id);
  if (!meeting) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  }

  if (meeting.status === "completed" && meeting.recordingFilePath) {
    try {
      const storageKey = buildRecordingStorageKey(meeting.id, meeting.url);
      const storage = StorageProviderFactory.getProvider();
      const signedUrl = await storage.getSignedUrl(storageKey);
      meeting.recordingFilePath = signedUrl;
    } catch (error) {
      console.warn("[/api/v1/extension/meetings/:id] Failed to sign recording URL:", error);
    }
  }

  return NextResponse.json(meeting);
}
