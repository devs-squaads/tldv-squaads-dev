import { withAuth } from "next-auth/middleware";

import { isAuthorizedToken, isPublicPagePath } from "@/lib/pageAuthGuard";

// Page-level auth gate, migrated here (not into a `middleware.ts`) because
// Next.js 16 does not allow both files to coexist and prioritizes `proxy.ts`.
// See docs/adr/0002-migrate-auth-gate-into-existing-proxy-ts.md.
export const proxy = withAuth({
  callbacks: {
    authorized: ({ token, req }) =>
      isPublicPagePath(req.nextUrl.pathname) || isAuthorizedToken(token),
  },
  pages: {
    signIn: "/login",
  },
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
