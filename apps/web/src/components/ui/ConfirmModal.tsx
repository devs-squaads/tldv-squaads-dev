"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface ConfirmModalProps {
  open: boolean;
  message: string;
  title?: string;
  confirmLabel?: string;
  /** Destructive-styled confirm button — true for all current call sites (delete/clear/revoke). */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Confirmation dialog — replaces window.confirm() with something that matches the site's design.
 *  Sibling to InfoModal: same portal/escape/backdrop-close/scroll-lock/mounted-guard conventions,
 *  but with two actions instead of one. */
export function ConfirmModal({
  open,
  message,
  title = "Confirmar accion",
  confirmLabel = "Confirmar",
  destructive = true,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    queueMicrotask(() => setMounted(true));
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  useEffect(() => {
    if (!mounted || !open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mounted, open]);

  if (!mounted || !open) return null;

  const modal = (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-[rgba(3,5,10,0.6)] p-4">
      <button type="button" aria-label="Cerrar" className="absolute inset-0 cursor-default" onClick={onCancel} />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        className="relative z-10 w-full max-w-sm rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--destructive)]/10">
            <AlertTriangle className="h-5 w-5 text-[var(--destructive)]" />
          </span>
          <div className="flex-1 space-y-1 pt-1">
            <h2 id="confirm-modal-title" className="text-base font-semibold text-[var(--foreground)]">
              {title}
            </h2>
            <p className="text-sm text-[var(--muted-foreground)] whitespace-pre-line">{message}</p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancelar
          </Button>
          <Button variant={destructive ? "destructive" : "primary"} size="sm" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
