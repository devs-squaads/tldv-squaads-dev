"use client";

import { Puzzle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { openExtensionInstallModal } from "@/modules/extension-install/modalBridge";

export function ExtensionInstallButton() {
  return (
    <>
      <Button variant="secondary" className="hidden sm:inline-flex gap-2" onClick={() => openExtensionInstallModal()}>
        <Puzzle className="h-4 w-4" />
        Instalar extension
      </Button>
      <Button variant="secondary" size="icon" className="sm:hidden" onClick={() => openExtensionInstallModal()} aria-label="Instalar extension">
        <Puzzle className="h-4 w-4" />
      </Button>
    </>
  );
}
