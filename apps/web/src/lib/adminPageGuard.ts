/**
 * Pure redirect rule for admin-only pages (013/ADR-0008 "Admin notification surface").
 * Dependency-free like `pageAuthGuard.ts` so it stays unit-testable without mocking
 * `getServerSession`.
 */

export interface AdminGuardSession {
  user?: {
    id?: string | null;
    role?: string | null;
  } | null;
}

/** Returns the redirect target for a non-admin caller, or `null` when the page may render. */
export function resolveAdminPageRedirect(
  session: AdminGuardSession | null | undefined
): "/login" | "/" | null {
  if (!session?.user?.id) return "/login";
  if (session.user.role !== "admin") return "/";
  return null;
}
