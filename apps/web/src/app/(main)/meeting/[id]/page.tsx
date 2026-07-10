import { notFound } from "next/navigation";
import { MeetingDetailsView } from "@/components/MeetingDetailsView";
import { SquaadsLogo } from "@/components/SquaadsLogo";
import { SquaadsTitle } from "@/components/SquaadsTitle";
import Link from "next/link";
import { buildRecordingStorageKey } from "@meeting-bot/shared/meetingProvider";
import { MeetingRepository } from "@meeting-bot/shared/repositories/MeetingRepository";
import { MeetingShareService } from "@/services/meetingShareService";
import { ThemeToggle } from "@/components/ThemeToggle";
import { GlassCursor } from "@/components/GlassLayout";
import VenomBeam from "@/components/ui/venom-beam";
import { UserMenu } from "@/components/UserMenu";

export const dynamic = "force-dynamic";

export default async function MeetingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const meeting = await MeetingRepository.findById(id);
  if (!meeting) {
    notFound();
  }

  const initialShares = await MeetingShareService.listSharesByMeetingId(id);
  const ttlOptionsMinutes = MeetingShareService.getTtlOptionsMinutes();
  // Try to generate a fresh signed URL for the recording
  const initialMeeting = { ...meeting };
  if (meeting.status === "completed" && meeting.recordingFilePath) {
    try {
      const { StorageProviderFactory } = await import("@meeting-bot/shared/integrations/storage/StorageProviderFactory");
      const storage = StorageProviderFactory.getProvider();
      const storageKey = buildRecordingStorageKey(meeting.id, meeting.url);

      console.log(`[MeetingPage] Generating signed URL for: ${storageKey}`);
      const signedUrl = await storage.getSignedUrl(storageKey);
      initialMeeting.recordingFilePath = signedUrl;
    } catch (err) {
      console.error("[MeetingPage] Failed to generate signed URL:", err);
    }
  }

  return (
    <div className="relative flex min-h-screen flex-col bg-[var(--background)]">
      <GlassCursor />

      <header className="sticky top-0 z-20" style={{ background: "var(--card)", backdropFilter: "blur(24px) saturate(1.8)", WebkitBackdropFilter: "blur(24px) saturate(1.8)", borderBottom: "1px solid var(--glass-border)" }}>
        <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(to right, rgba(0,242,255,0.02), transparent, rgba(0,242,255,0.02))" }} />
        <div className="relative container mx-auto flex h-16 items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <SquaadsLogo />
            <SquaadsTitle />
          </Link>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <UserMenu />
          </div>
        </div>
      </header>

      <VenomBeam className="flex-1">
        <main className="container mx-auto px-4 py-8 sm:px-6">
          <MeetingDetailsView
            initialMeeting={initialMeeting}
            initialShares={initialShares}
            ttlOptionsMinutes={ttlOptionsMinutes}
          />
        </main>
      </VenomBeam>
    </div>
  );
}
