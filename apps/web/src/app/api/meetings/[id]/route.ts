import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { MeetingRepository } from "@meeting-bot/shared/repositories/MeetingRepository";
import { WebMeetingRepository } from "@/repositories/WebMeetingRepository";
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
  const sessionUserId = (session?.user as { id?: string } | undefined)?.id;
  const hasApiSecret = Boolean(secret && authHeader === `Bearer ${secret}`);

  if (!sessionUserId && !hasApiSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: "Meeting ID is required" }, { status: 400 });
  }

  // Dos caminos con reglas distintas (spec 015):
  //  - Session Auth: se aplica la misma visibilidad que el dashboard (owner o Access Grant vivo).
  //    Sin esto, cualquier cuenta autorizada podía leer la reunión de cualquier otra por id.
  //  - `Bearer API_ROUTE_SECRET`: canal server-to-server de confianza (el worker lee reuniones que
  //    no posee), así que NO se scopea por ownership — scopearlo rompería el pipeline.
  // Se devuelve 404 y no 403 para no filtrar la existencia de ids ajenos.
  const meeting = sessionUserId
    ? await WebMeetingRepository.findByIdForUser(sessionUserId, id)
    : await MeetingRepository.findById(id);

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
