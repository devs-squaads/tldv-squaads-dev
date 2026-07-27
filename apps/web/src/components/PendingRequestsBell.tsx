"use client";

import { useSession } from "next-auth/react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { shouldRenderPendingBell } from "./pendingRequestsBell.logic";

interface PendingRequestsBellProps {
  /** Global pending `Share Request` count, fetched server-side by `AppHeader` (no polling — 013/ADR-0008). */
  pendingCount: number;
}

/**
 * Admin-only navbar bell (013/ADR-0008 "Admin notification surface"). Self-guards on the
 * client session role — same null-for-non-admin idiom as `UserMenu.tsx` — so it stays safe
 * even if ever rendered outside `AppHeader`'s server-side gate.
 */
export function PendingRequestsBell({ pendingCount }: PendingRequestsBellProps) {
  const { data: session } = useSession();

  if (!shouldRenderPendingBell(session?.user?.role)) return null;

  return (
    <Link
      href="/admin/share-requests"
      className="relative flex items-center justify-center w-10 h-10 rounded-full border border-[#00F2FF]/30 hover:border-[#00F2FF]/60 transition-all"
      style={{
        background: "var(--card)",
        backdropFilter: "blur(12px) saturate(1.4)",
        WebkitBackdropFilter: "blur(12px) saturate(1.4)",
      }}
      aria-label="Solicitudes de compartición pendientes"
    >
      <Bell className="h-4 w-4 text-[var(--foreground)]" />
      {pendingCount > 0 && (
        <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--destructive)] px-1 text-[10px] font-semibold text-[var(--destructive-foreground)]">
          {pendingCount > 99 ? "99+" : pendingCount}
        </span>
      )}
    </Link>
  );
}
