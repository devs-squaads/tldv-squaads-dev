import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import CredentialsProvider from "next-auth/providers/credentials";
import type { AuthorizedAccountRole } from "@meeting-bot/shared/repositories/AuthorizedAccountRepository";

interface AuthorizedAccountSummary {
  role: AuthorizedAccountRole;
  isActive: boolean;
}

interface AuthorizedAccountInput extends AuthorizedAccountSummary {
  email: string;
}

interface GoogleUserInput {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

interface CalendarTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

export interface AuthCallbackDependencies {
  findAuthorizedAccount(email: string): Promise<AuthorizedAccountSummary | null>;
  upsertAuthorizedAccount(input: AuthorizedAccountInput): Promise<AuthorizedAccountSummary>;
  upsertUserFromGoogle(input: GoogleUserInput): Promise<unknown>;
  updateCalendarTokens(userId: string, tokens: CalendarTokens): Promise<unknown>;
}

export type AuthorizedAccountsDependencies = { getServerSession: typeof import("next-auth")["getServerSession"]; AuthorizedAccountRepository: Pick<typeof import("@meeting-bot/shared/repositories/AuthorizedAccountRepository")["AuthorizedAccountRepository"], "findAll" | "upsert"> };
export type AuthorizedAccountEmailDependencies = { getServerSession: typeof import("next-auth")["getServerSession"]; AuthorizedAccountRepository: Pick<typeof import("@meeting-bot/shared/repositories/AuthorizedAccountRepository")["AuthorizedAccountRepository"], "findAll" | "findByEmail" | "remove" | "setActive" | "setRole"> };
const adminRouteDependencies = globalThis as typeof globalThis & { __squaadsAdminRouteDependencies?: { authorizedAccounts?: AuthorizedAccountsDependencies; authorizedAccountEmail?: AuthorizedAccountEmailDependencies } };
export function createAuthorizedAccountsHandlers(dependencies: AuthorizedAccountsDependencies) { (adminRouteDependencies.__squaadsAdminRouteDependencies ??= {}).authorizedAccounts = dependencies; return import("@/app/api/admin/authorized-accounts/route"); }
export function createAuthorizedAccountEmailHandlers(dependencies: AuthorizedAccountEmailDependencies) { (adminRouteDependencies.__squaadsAdminRouteDependencies ??= {}).authorizedAccountEmail = dependencies; return import("@/app/api/admin/authorized-accounts/[email]/route"); }

const defaultAuthCallbackDependencies: AuthCallbackDependencies = {
  async findAuthorizedAccount(email) {
    const { AuthorizedAccountRepository } = await import(
      "@meeting-bot/shared/repositories/AuthorizedAccountRepository"
    );
    return AuthorizedAccountRepository.findByEmail(email);
  },
  async upsertAuthorizedAccount(input) {
    const { AuthorizedAccountRepository } = await import(
      "@meeting-bot/shared/repositories/AuthorizedAccountRepository"
    );
    return AuthorizedAccountRepository.upsert(input);
  },
  async upsertUserFromGoogle(input) {
    const { UserRepository } = await import("@/repositories/UserRepository");
    return UserRepository.upsertFromGoogle(input);
  },
  async updateCalendarTokens(userId, tokens) {
    const { CalendarAccountRepository } = await import(
      "@meeting-bot/shared/repositories/CalendarAccountRepository"
    );
    return CalendarAccountRepository.updateTokens(userId, tokens);
  },
};

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
async function resolveAuthorizedRole(
  email: string,
  dependencies: AuthCallbackDependencies,
): Promise<AuthorizedAccountRole | null> {
  const normalizedEmail = email.toLowerCase();

  if (getSuperAdminEmails().includes(normalizedEmail)) {
    const account = await dependencies.upsertAuthorizedAccount({
      email: normalizedEmail,
      role: "admin",
      isActive: true,
    });
    return account.role;
  }

  const account = await dependencies.findAuthorizedAccount(normalizedEmail);
  if (!account || !account.isActive) return null;
  return account.role;
}

export function createAuthCallbacks(
  dependencies: AuthCallbackDependencies,
): NonNullable<NextAuthOptions["callbacks"]> {
  return {
    async signIn({ user, account }) {
      if (!account || !user.email) return false;

      // Dev bypass exists to skip Google's OAuth dance entirely for local
      // dev — isDevAuthBypassEnabled() is the actual security boundary
      // (non-production + an explicitly-set env var); requiring the bypass
      // identity to ALSO be pre-provisioned in authorized_accounts would
      // defeat the point of a bypass, since it could then only ever be used
      // with an email someone already registered ahead of time.
      if (account.provider === "dev-bypass") {
        await dependencies.upsertUserFromGoogle({
          id: user.id,
          name: user.name || null,
          email: user.email,
          image: user.image || null,
          accessToken: account.access_token || "",
          refreshToken: account.refresh_token,
          expiresAt: account.expires_at,
        });
        return true;
      }

      const role = await resolveAuthorizedRole(user.email, dependencies);
      if (!role) return false;

      await dependencies.upsertUserFromGoogle({
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
        if (account.provider === "dev-bypass") {
          token.isDevBypass = true;
        }
      }

      // Re-resolve the role on every call (not only at initial sign-in) so a
      // deactivation from the Equipo admin UI takes effect on the user's next
      // request instead of waiting up to the session's maxAge to expire.
      // Dev-bypass sessions never touch the allowlist — see the signIn callback.
      if (token.isDevBypass) {
        token.role = "admin";
      } else {
        const email = user?.email ?? (token.email as string | undefined);
        if (email) {
          const authorizedAccount = await dependencies.findAuthorizedAccount(email.toLowerCase());
          token.role = authorizedAccount?.isActive ? authorizedAccount.role : undefined;
        }
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
                await dependencies.updateCalendarTokens(token.userId as string, {
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
  };
}

/**
 * Never true on Production: VERCEL_ENV is only absent (local) or "preview" outside
 * of a real Production deployment, so a misconfigured DEV_AUTH_BYPASS_EMAIL can't
 * leak the bypass into production even if someone copies it there by mistake.
 */
export function isDevAuthBypassEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VERCEL_ENV !== "production" && Boolean(env.DEV_AUTH_BYPASS_EMAIL);
}

function createDevBypassProvider(env: NodeJS.ProcessEnv) {
  return CredentialsProvider({
    id: "dev-bypass",
    name: "Dev bypass",
    credentials: {},
    async authorize() {
      const email = env.DEV_AUTH_BYPASS_EMAIL;
      if (!email) return null;
      return { id: "dev-bypass", email, name: "Dev bypass", image: null };
    },
  });
}

export function createAuthProviders(env: NodeJS.ProcessEnv = process.env): NextAuthOptions["providers"] {
  return [
    GoogleProvider({
      clientId: env.GOOGLE_CLIENT_ID || "",
      clientSecret: env.GOOGLE_CLIENT_SECRET || "",
      authorization: {
        params: {
          // Identity only — Calendar access is requested separately from Settings.
          scope: ["openid", "email", "profile"].join(" "),
          prompt: "select_account",
        },
      },
    }),
    ...(isDevAuthBypassEnabled(env) ? [createDevBypassProvider(env)] : []),
  ];
}

export const authOptions: NextAuthOptions = {
  providers: createAuthProviders(),

  callbacks: createAuthCallbacks(defaultAuthCallbackDependencies),

  pages: {
    signIn: "/login",
  },

  session: {
    strategy: "jwt",
  },

  secret: process.env.NEXTAUTH_SECRET || "squaads-dev-secret-change-in-production",
};
