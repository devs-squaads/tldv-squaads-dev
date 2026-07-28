"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, CheckCircle2, Info, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/Button";

export type InfoModalVariant = "error" | "info" | "success";

interface InfoModalProps {
  open: boolean;
  variant?: InfoModalVariant;
  /** Optional heading; falls back to a sensible default per variant. */
  title?: string;
  message: string;
  onClose: () => void;
}

const VARIANT_CONFIG: Record<
  InfoModalVariant,
  { icon: LucideIcon; defaultTitle: string; iconClassName: string; badgeClassName: string }
> = {
  error: {
    icon: AlertCircle,
    defaultTitle: "Error",
    iconClassName: "text-[var(--destructive)]",
    badgeClassName: "bg-[var(--destructive)]/10",
  },
  info: {
    icon: Info,
    defaultTitle: "Aviso",
    iconClassName: "text-blue-500",
    badgeClassName: "bg-blue-500/10",
  },
  success: {
    icon: CheckCircle2,
    defaultTitle: "Listo",
    iconClassName: "text-[#00F2FF]",
    badgeClassName: "bg-[#00F2FF]/10",
  },
};

/** Small centered confirmation dialog — replaces window.alert() with something that matches the
 *  site's design. Reuses ExtensionInstallModalHost's structural conventions (portal, escape/backdrop
 *  close, body scroll lock, mounted guard) at a much smaller scale: one message, not a whole flow. */
export function InfoModal({ open, variant = "info", title, message, onClose }: InfoModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    queueMicrotask(() => setMounted(true));
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!mounted || !open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mounted, open]);

  if (!mounted || !open) return null;

  const config = VARIANT_CONFIG[variant];
  const Icon = config.icon;
  const heading = title || config.defaultTitle;

  const modal = (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-[rgba(3,5,10,0.6)] p-4">
      <button type="button" aria-label="Cerrar" className="absolute inset-0 cursor-default" onClick={onClose} />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="info-modal-title"
        className="relative z-10 w-full max-w-sm rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl"
      >
        <div className="flex items-start gap-3">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${config.badgeClassName}`}>
            <Icon className={`h-5 w-5 ${config.iconClassName}`} />
          </span>
          <div className="flex-1 space-y-1 pt-1">
            <h2 id="info-modal-title" className="text-base font-semibold text-[var(--foreground)]">
              {heading}
            </h2>
            <p className="text-sm text-[var(--muted-foreground)] whitespace-pre-line">{message}</p>
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <Button size="sm" onClick={onClose}>
            Entendido
          </Button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
