import SettingsView from "@/components/SettingsView";
import Link from "next/link";
import { SquaadsLogo } from "@/components/SquaadsLogo";
import { SquaadsTitle } from "@/components/SquaadsTitle";
import { WebSettingsRepository } from "@/repositories/WebSettingsRepository";
import { ThemeToggle } from "@/components/ThemeToggle";
import { GlassCursor } from "@/components/GlassLayout";
import VenomBeam from "@/components/ui/venom-beam";
import { InteractiveHoverButton } from "@/components/ui/interactive-hover-button";
import { UserMenu } from "@/components/UserMenu";
import { ExtensionInstallButton } from "@/components/ExtensionInstallButton";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const settingsObj = await WebSettingsRepository.toRecord();

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
            <ExtensionInstallButton />
            <ThemeToggle />
            <Link href="/">
              <InteractiveHoverButton direction="left" className="text-sm">
                Volver
              </InteractiveHoverButton>
            </Link>
            <UserMenu />
          </div>
        </div>
      </header>

      <VenomBeam className="flex-1">
        <main className="container mx-auto px-4 py-12 sm:px-6">
          <SettingsView initialSettings={settingsObj} />
        </main>
      </VenomBeam>
    </div>
  );
}
