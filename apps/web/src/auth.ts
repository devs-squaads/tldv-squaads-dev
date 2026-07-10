import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { UserRepository } from "@/repositories/UserRepository";
import { CalendarAccountRepository } from "@meeting-bot/shared/repositories/CalendarAccountRepository";
import {
  AuthorizedAccountRepository,
  type AuthorizedAccountRole,
} from "@meeting-bot/shared/repositories/AuthorizedAccountRepository";

function getSuperAdminEmails(): string[] {
  return (process.env.SUPER_ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Allowlist gate: only emails already in `authorized_accounts` (or listed in
 * SUPER_ADMIN_EMAILS, auto-provisioned as admin) may sign in.
 */
async function resolveAuthorizedRole(email: string): Promise<AuthorizedAccountRole | null> {
  const normalizedEmail = email.toLowerCase();

  if (getSuperAdminEmails().includes(normalizedEmail)) {
    const account = await AuthorizedAccountRepository.upsert({
      email: normalizedEmail,
      role: "admin",
      isActive: true,
    });
    return account.role;
  }

  const account = await AuthorizedAccountRepository.findByEmail(normalizedEmail);
  if (!account || !account.isActive) return null;
  return account.role;
}

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      authorization: {
        params: {
          // Identity only — Calendar access is requested separately from Settings.
          scope: ["openid", "email", "profile"].join(" "),
          prompt: "select_account",
        },
      },
    }),
  ],

  callbacks: {
    async signIn({ user, account }) {
      if (!account || !user.email) return false;

      const role = await resolveAuthorizedRole(user.email);
      if (!role) return false;

      await UserRepository.upsertFromGoogle({
        id: user.id,
        name: user.name || null,
        email: user.email,
        image: user.image || null,
        accessToken: account.access_token || "",
        refreshToken: account.refresh_token,
        expiresAt: account.expires_at,
      });

      return true;
    },

    async jwt({ token, account, user }) {
      // On initial sign-in, store tokens in JWT
      if (account && user) {
        token.userId = user.id;
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt = account.expires_at;
      }

      // Re-resolve the role on every call (not only at initial sign-in) so a
      // deactivation from the Equipo admin UI takes effect on the user's next
      // request instead of waiting up to the session's maxAge to expire.
      const email = user?.email ?? (token.email as string | undefined);
      if (email) {
        const authorizedAccount = await AuthorizedAccountRepository.findByEmail(email.toLowerCase());
        token.role = authorizedAccount?.isActive ? authorizedAccount.role : undefined;
      }

      // Check if token needs refresh
      if (token.expiresAt && typeof token.expiresAt === "number") {
        const expiresIn = token.expiresAt * 1000 - Date.now();
        if (expiresIn < 5 * 60 * 1000 && token.refreshToken) {
          try {
            const response = await fetch("https://oauth2.googleapis.com/token", {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                client_id: process.env.GOOGLE_CLIENT_ID || "",
                client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
                grant_type: "refresh_token",
                refresh_token: token.refreshToken as string,
              }),
            });

            const data = await response.json();

            if (data.access_token) {
              token.accessToken = data.access_token;
              token.expiresAt = Math.floor(Date.now() / 1000) + data.expires_in;

              // Update in DB too
              if (token.userId) {
                await CalendarAccountRepository.updateTokens(token.userId as string, {
                  accessToken: data.access_token,
                  expiresAt: token.expiresAt as number,
                  ...(data.refresh_token ? { refreshToken: data.refresh_token } : {}),
                });
              }
            }
          } catch (error) {
            console.error("[Auth] Token refresh failed:", error);
          }
        }
      }

      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        (session.user as Record<string, unknown>).id = token.userId;
        (session.user as Record<string, unknown>).role = token.role;
      }
      return session;
    },
  },

  pages: {
    signIn: "/login",
  },

  session: {
    strategy: "jwt",
  },

  secret: process.env.NEXTAUTH_SECRET || "squaads-dev-secret-change-in-production",
};
