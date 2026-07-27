import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { MeetingDetailsView } from "@/components/MeetingDetailsView";
import { AppHeader } from "@/components/AppHeader";
import { buildRecordingStorageKey } from "@meeting-bot/shared/meetingProvider";
import { authOptions } from "@/auth";
import { WebMeetingRepository } from "@/repositories/WebMeetingRepository";
import { MeetingShareService } from "@/services/meetingShareService";
import { ParticipantSuggestionService } from "@/services/participantSuggestionService";
import { ThemeToggle } from "@/components/ThemeToggle";
import { GlassCursor } from "@/components/GlassLayout";
import VenomBeam from "@/components/ui/venom-beam";

export const dynamic = "force-dynamic";

export default async function MeetingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");

  const meeting = await WebMeetingRepository.findByIdForUser(session.user.id, id);
  if (!meeting) {
    notFound();
  }

  const initialShares = await MeetingShareService.listSharesByMeetingId(id);
  const ttlOptionsMinutes = MeetingShareService.getTtlOptionsMinutes();
  const participantSuggestions = await ParticipantSuggestionService.resolveSuggestions(
    meeting.participantEmails,
  );
  // Try to generate fresh signed URLs for the recording — inline for the <video> player,
  // attachment for the download link (a single attachment-disposition URL can't do both;
  // browsers refuse to play a <video> whose response forces a download).
  const initialMeeting: typeof meeting & { recordingDownloadUrl?: string | null } = { ...meeting };
  if (meeting.status === "completed" && meeting.recordingFilePath) {
    try {
      const { StorageProviderFactory } = await import("@meeting-bot/shared/integrations/storage/StorageProviderFactory");
      const storage = StorageProviderFactory.getProvider();
      const storageKey = meeting.recordingStorageKey ?? buildRecordingStorageKey(meeting.id, meeting.url);

      console.log(`[MeetingPage] Generating signed URL for: ${storageKey}`);
      const [signedUrl, downloadUrl] = await Promise.all([
        storage.getSignedUrl(storageKey, undefined, "inline"),
        storage.getSignedUrl(storageKey, undefined, "attachment"),
      ]);
      initialMeeting.recordingFilePath = signedUrl;
      initialMeeting.recordingDownloadUrl = downloadUrl;
    } catch (err) {
      console.error("[MeetingPage] Failed to generate signed URL:", err);
    }
  }

  return (
    <div className="relative flex min-h-screen flex-col bg-[var(--background)]">
      <GlassCursor />

      <AppHeader>
        <ThemeToggle />
      </AppHeader>

      <VenomBeam className="flex-1">
        <main className="container mx-auto px-4 py-8 sm:px-6">
          <MeetingDetailsView
            initialMeeting={initialMeeting}
            initialShares={initialShares}
            ttlOptionsMinutes={ttlOptionsMinutes}
            participantSuggestions={participantSuggestions}
          />
        </main>
      </VenomBeam>
    </div>
  );
}
