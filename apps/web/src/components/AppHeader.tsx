import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { SquaadsLogo } from "@/components/SquaadsLogo";
import { SquaadsTitle } from "@/components/SquaadsTitle";
import { UserMenu } from "@/components/UserMenu";
import { PendingRequestsBell } from "@/components/PendingRequestsBell";
import { ShareRequestService } from "@/services/shareRequestService";

/**
 * Shared header extracted from the 3 previously-duplicated inline `<header>`s
 * (`(main)/page.tsx`, `settings/page.tsx`, `meeting/[id]/page.tsx` — 013/ADR-0008).
 * `children` carries whatever page-specific actions used to sit between the logo and
 * `UserMenu`, in their original order, so no page's visual layout changes beyond the
 * new admin-only bell inserted right before `UserMenu`.
 */
export async function AppHeader({ children }: { children?: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  const isAdmin = session?.user?.role === "admin";
  const pendingCount = isAdmin ? await ShareRequestService.countPending() : 0;

  return (
    <header
      className="sticky top-0 z-20"
      style={{
        background: "var(--card)",
        backdropFilter: "blur(24px) saturate(1.8)",
        WebkitBackdropFilter: "blur(24px) saturate(1.8)",
        borderBottom: "1px solid var(--glass-border)",
      }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: "linear-gradient(to right, rgba(0,242,255,0.02), transparent, rgba(0,242,255,0.02))" }}
      />
      <div className="relative container mx-auto flex h-16 items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <SquaadsLogo />
          <SquaadsTitle />
        </Link>
        <div className="flex items-center gap-3">
          {children}
          <PendingRequestsBell pendingCount={pendingCount} />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
