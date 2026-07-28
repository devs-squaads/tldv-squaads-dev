import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { AppHeader } from "@/components/AppHeader";
import { ThemeToggle } from "@/components/ThemeToggle";
import { GlassCursor } from "@/components/GlassLayout";
import VenomBeam from "@/components/ui/venom-beam";
import { AdminShareRequestsView, type AdminShareRequestListItem } from "@/components/AdminShareRequestsView";
import { resolveMeetingDisplayName } from "@/components/adminShareRequests.logic";
import { ShareRequestService } from "@/services/shareRequestService";
import { resolveAdminPageRedirect } from "@/lib/adminPageGuard";
import { UserRepository } from "@meeting-bot/shared/repositories/UserRepository";
import { MeetingRepository } from "@meeting-bot/shared/repositories/MeetingRepository";

export const dynamic = "force-dynamic";

export default async function AdminShareRequestsPage() {
  const session = await getServerSession(authOptions);
  const redirectTo = resolveAdminPageRedirect(session);
  if (redirectTo) redirect(redirectTo);

  const requests = await ShareRequestService.listPending();

  // 013 admin feedback: pending-request cards showed raw ids and "Reunión meeting-<uuid>"
  // instead of real, actionable information. This list spans ALL meetings/requesters
  // platform-wide (unlike the per-meeting page), so both grantee AND requester users need
  // resolving, plus every referenced meeting's display name. A handful of `findById` calls via
  // Promise.all is simpler and equally correct here — pending lists aren't going to be huge, so
  // a batch MeetingRepository method would be premature.
  const userIds = Array.from(
    new Set([
      ...requests.flatMap((r) => (r.granteeUserId ? [r.granteeUserId] : [])),
      ...requests.map((r) => r.requesterId),
    ]),
  );
  const meetingIds = Array.from(new Set(requests.map((r) => r.meetingId)));

  const [users, meetings] = await Promise.all([
    UserRepository.findByIds(userIds),
    Promise.all(meetingIds.map((meetingId) => MeetingRepository.findById(meetingId))),
  ]);

  const emailByUserId = new Map(users.map((user) => [user.id, user.email]));
  const meetingById = new Map(
    meetings.filter((m): m is NonNullable<typeof m> => m !== null).map((m) => [m.id, m]),
  );

  const enrichedRequests: AdminShareRequestListItem[] = requests.map((request) => ({
    ...request,
    granteeEmail: request.granteeUserId ? emailByUserId.get(request.granteeUserId) : undefined,
    requesterEmail: emailByUserId.get(request.requesterId) ?? `Usuario ${request.requesterId}`,
    meetingName: resolveMeetingDisplayName(meetingById.get(request.meetingId) ?? null),
  }));

  return (
    <div className="relative flex min-h-screen flex-col bg-[var(--background)]">
      <GlassCursor />

      <AppHeader>
        <ThemeToggle />
      </AppHeader>

      <VenomBeam className="flex-1">
        <main className="container mx-auto px-4 py-8 sm:px-6">
          <AdminShareRequestsView initialRequests={enrichedRequests} />
        </main>
      </VenomBeam>
    </div>
  );
}
