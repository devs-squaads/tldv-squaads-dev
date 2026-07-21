import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { Settings } from "lucide-react";
import { authOptions } from "@/auth";
import { SquaadsLogo } from "@/components/SquaadsLogo";
import { SquaadsTitle } from "@/components/SquaadsTitle";
import { DashboardClient } from "@/components/DashboardClient";
import { ThemeToggle } from "@/components/ThemeToggle";
import { GlassCursor } from "@/components/GlassLayout";
import VenomBeam from "@/components/ui/venom-beam";
import { InteractiveHoverButton } from "@/components/ui/interactive-hover-button";
import { UserMenu } from "@/components/UserMenu";
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

      <header className="sticky top-0 z-20" style={{ background: "var(--card)", backdropFilter: "blur(24px) saturate(1.8)", WebkitBackdropFilter: "blur(24px) saturate(1.8)", borderBottom: "1px solid var(--glass-border)" }}>
        <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(to right, rgba(0,242,255,0.02), transparent, rgba(0,242,255,0.02))" }} />
        <div className="relative container mx-auto flex h-16 items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <SquaadsLogo />
            <SquaadsTitle />
          </Link>
          <div className="flex items-center gap-3">
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
            <UserMenu />
          </div>
        </div>
      </header>

      <VenomBeam className="flex-1">
        <main className="container mx-auto px-4 py-8 sm:px-6">
          <DashboardClient meetings={allMeetings} />
        </main>
      </VenomBeam>
    </div>
  );
}
