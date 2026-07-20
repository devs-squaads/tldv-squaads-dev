import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { MeetingRepository } from "@meeting-bot/shared/repositories/MeetingRepository";
import { buildRecordingStorageKey } from "@meeting-bot/shared/meetingProvider";
import { StorageProviderFactory } from "@meeting-bot/shared/integrations/storage/StorageProviderFactory";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authHeader = request.headers.get("Authorization");
  const secret = process.env.API_ROUTE_SECRET;
  const session = await getServerSession(authOptions);
  const hasWebSession = Boolean(session?.user?.email);
  const hasApiSecret = Boolean(secret && authHeader === `Bearer ${secret}`);

  if (!hasWebSession && !hasApiSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
      const storageKey = meeting.recordingStorageKey ?? buildRecordingStorageKey(meeting.id, meeting.url);
      const storage = StorageProviderFactory.getProvider();
      const signedUrl = await storage.getSignedUrl(storageKey);
      meeting.recordingFilePath = signedUrl;
    } catch (error) {
      console.warn("[/api/meetings/:id] Failed to sign recording URL:", error);
    }
  }

  return NextResponse.json(meeting);
}
