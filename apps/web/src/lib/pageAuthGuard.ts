/**
 * Pure page-auth gating rules, used by `proxy.ts`.
 * Kept dependency-free (no Next.js/next-auth imports) so they stay
 * unit-testable without mocking a request/response cycle.
 */

export interface PageAuthToken {
  role?: unknown;
  [key: string]: unknown;
}

/** A token only grants access to protected pages when it carries an active role. */
export function isAuthorizedToken(token: PageAuthToken | null | undefined): boolean {
  return !!token && !!token.role;
}

/** Routes that render without a Session Auth, on purpose (see CONTEXT.md → Public Route). */
export function isPublicPagePath(pathname: string): boolean {
  return pathname === "/login" || pathname.startsWith("/share/");
}
