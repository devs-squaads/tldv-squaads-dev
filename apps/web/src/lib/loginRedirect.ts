/**
 * Pure redirect-target resolver for `/login`, shared by the login page.
 * Kept dependency-free so it stays unit-testable in isolation.
 */

/**
 * Resolves where to send the user after login (or when already authenticated).
 * Only accepts a same-origin internal path (`/x`) to avoid an open redirect via
 * `callbackUrl`; anything else (missing, protocol-relative `//`, or absolute
 * `https://...`) falls back to the dashboard root.
 */
export function resolveLoginRedirect(callbackUrl: string | null | undefined): string {
  if (!callbackUrl) return "/";
  if (!callbackUrl.startsWith("/") || callbackUrl.startsWith("//")) return "/";
  return callbackUrl;
}
