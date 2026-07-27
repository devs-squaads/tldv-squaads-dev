import SettingsView from "@/components/SettingsView";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { WebSettingsRepository } from "@/repositories/WebSettingsRepository";
import { ThemeToggle } from "@/components/ThemeToggle";
import { GlassCursor } from "@/components/GlassLayout";
import VenomBeam from "@/components/ui/venom-beam";
import { InteractiveHoverButton } from "@/components/ui/interactive-hover-button";
import { ExtensionInstallButton } from "@/components/ExtensionInstallButton";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const settingsObj = await WebSettingsRepository.toRecord();

  return (
    <div className="relative flex min-h-screen flex-col bg-[var(--background)]">
      <GlassCursor />

      <AppHeader>
        <ExtensionInstallButton />
        <ThemeToggle />
        <Link href="/">
          <InteractiveHoverButton direction="left" className="text-sm">
            Volver
          </InteractiveHoverButton>
        </Link>
      </AppHeader>

      <VenomBeam className="flex-1">
        <main className="container mx-auto px-4 py-12 sm:px-6">
          <SettingsView initialSettings={settingsObj} />
        </main>
      </VenomBeam>
    </div>
  );
}
