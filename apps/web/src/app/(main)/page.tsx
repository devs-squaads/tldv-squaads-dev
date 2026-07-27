import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { Settings } from "lucide-react";
import { authOptions } from "@/auth";
import { AppHeader } from "@/components/AppHeader";
import { DashboardClient } from "@/components/DashboardClient";
import { ThemeToggle } from "@/components/ThemeToggle";
import { GlassCursor } from "@/components/GlassLayout";
import VenomBeam from "@/components/ui/venom-beam";
import { InteractiveHoverButton } from "@/components/ui/interactive-hover-button";
import { ExtensionInstallButton } from "@/components/ExtensionInstallButton";
import { WebMeetingRepository } from "@/repositories/WebMeetingRepository";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");

  const allMeetings = await WebMeetingRepository.listRecent(session.user.id);

  return (
    <div className="relative flex min-h-screen flex-col bg-[var(--background)]">
      {/* Glass cursor */}
      <GlassCursor />

      <AppHeader>
        <ExtensionInstallButton />
        <ThemeToggle />
        <Link href="/settings">
          <div
            className="hidden sm:flex w-10 h-10 items-center justify-center rounded-full border border-[#00F2FF]/30 hover:border-[#00F2FF]/60 transition-all"
            style={{
              background: "var(--card)",
              backdropFilter: "blur(12px) saturate(1.4)",
              WebkitBackdropFilter: "blur(12px) saturate(1.4)",
            }}
          >
            <Settings className="h-4 w-4 text-[var(--foreground)]" />
          </div>
        </Link>
        <Link href="/new">
          <InteractiveHoverButton className="text-sm">
            Nueva Reunion
          </InteractiveHoverButton>
        </Link>
      </AppHeader>

      <VenomBeam className="flex-1">
        <main className="container mx-auto px-4 py-8 sm:px-6">
          <DashboardClient meetings={allMeetings} />
        </main>
      </VenomBeam>
    </div>
  );
}
