import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { AppHeader } from "@/components/AppHeader";
import { ThemeToggle } from "@/components/ThemeToggle";
import { GlassCursor } from "@/components/GlassLayout";
import VenomBeam from "@/components/ui/venom-beam";
import { AdminShareRequestsView } from "@/components/AdminShareRequestsView";
import { ShareRequestService } from "@/services/shareRequestService";
import { resolveAdminPageRedirect } from "@/lib/adminPageGuard";

export const dynamic = "force-dynamic";

export default async function AdminShareRequestsPage() {
  const session = await getServerSession(authOptions);
  const redirectTo = resolveAdminPageRedirect(session);
  if (redirectTo) redirect(redirectTo);

  const requests = await ShareRequestService.listPending();

  return (
    <div className="relative flex min-h-screen flex-col bg-[var(--background)]">
      <GlassCursor />

      <AppHeader>
        <ThemeToggle />
      </AppHeader>

      <VenomBeam className="flex-1">
        <main className="container mx-auto px-4 py-8 sm:px-6">
          <AdminShareRequestsView initialRequests={requests} />
        </main>
      </VenomBeam>
    </div>
  );
}
