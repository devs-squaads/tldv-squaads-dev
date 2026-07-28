import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { MeetingDetailsView } from "@/components/MeetingDetailsView";
import { AppHeader } from "@/components/AppHeader";
import { buildRecordingStorageKey } from "@meeting-bot/shared/meetingProvider";
import { authOptions } from "@/auth";
import { WebMeetingRepository } from "@/repositories/WebMeetingRepository";
import { MeetingShareService } from "@/services/meetingShareService";
import { MeetingAccessGrantService } from "@/services/meetingAccessGrantService";
import { ShareRequestService } from "@/services/shareRequestService";
import type { ShareRequestRecord } from "@/services/shareRequestService";
import { ParticipantSuggestionService } from "@/services/participantSuggestionService";
import { UserRepository } from "@meeting-bot/shared/repositories/UserRepository";
import type { MeetingAccessGrantRecord } from "@meeting-bot/shared/repositories/MeetingAccessGrantRepository";
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

  // 013 Phase 6.6: the "Solicitudes y accesos" passive-discovery section only makes sense for
  // the Owner (both services throw "Only the meeting owner can..." for anyone else) — a
  // non-owner viewer here is only visiting via their own live Access Grant (see
  // WebMeetingRepository.findByIdForUser's visibleToUser rule), so they get empty lists instead
  // of a page-crashing ownership error.
  const isOwner = meeting.ownerId === session.user.id;
  const [grants, shareRequests]: [MeetingAccessGrantRecord[], ShareRequestRecord[]] = isOwner
    ? await Promise.all([
        MeetingAccessGrantService.listGrantsByMeetingId(session.user.id, id),
        ShareRequestService.listByMeetingId(session.user.id, id),
      ])
    : [[], []];

  // 013 human feedback: "Solicitudes y accesos" showed raw ids like "Usuario 106929991040359390199"
  // instead of the person's email. Batch-resolve every referenced granteeUserId in one query
  // (depends on the grants/requests fetched above, so it can't join the Promise.all itself —
  // but it's still a single extra round-trip instead of one lookup per row).
  const granteeUserIds = Array.from(
    new Set([
      ...grants.map((grant) => grant.granteeUserId),
      ...shareRequests.flatMap((request) => (request.granteeUserId ? [request.granteeUserId] : [])),
    ]),
  );
  const granteeUsers = await UserRepository.findByIds(granteeUserIds);
  const emailByUserId = new Map(granteeUsers.map((user) => [user.id, user.email]));

  const initialGrants = grants.map((grant) => ({ ...grant, granteeEmail: emailByUserId.get(grant.granteeUserId) }));
  const initialShareRequests = shareRequests.map((request) => ({
    ...request,
    granteeEmail: request.granteeUserId ? emailByUserId.get(request.granteeUserId) : undefined,
  }));
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
            initialGrants={initialGrants}
            initialShareRequests={initialShareRequests}
          />
        </main>
      </VenomBeam>
    </div>
  );
}
