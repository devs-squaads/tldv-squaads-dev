/// <reference types="bun" />

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { authOptions, createAuthCallbacks, createAuthProviders, isDevAuthBypassEnabled } from "../../../web/src/auth";

const originalSuperAdmins = process.env.SUPER_ADMIN_EMAILS;

describe("auth.ts allowlist gate", () => {
  const findAuthorizedAccount = mock(async () => null);
  const upsertAuthorizedAccount = mock(async (input: { role: "admin" | "member"; isActive: boolean }) => ({
    role: input.role,
    isActive: input.isActive,
  }));
  const upsertUserFromGoogle = mock(async () => undefined);
  // Deliberately NOT part of AuthCallbackDependencies anymore: the google_* token
  // columns are owned by the calendar-connect flow. It is still passed here (as an
  // extra property on a non-literal object, so no excess-property error) purely as
  // a tripwire — if the callbacks ever reach for a token writer again, the
  // "no DB write" assertions below fail instead of the regression shipping.
  const updateCalendarTokens = mock(async () => undefined);

  const dependencies = {
    findAuthorizedAccount,
    upsertAuthorizedAccount,
    upsertUserFromGoogle,
    updateCalendarTokens,
  };

  const callbacks = createAuthCallbacks(dependencies);

  beforeEach(() => {
    findAuthorizedAccount.mockReset();
    findAuthorizedAccount.mockResolvedValue(null);
    upsertAuthorizedAccount.mockClear();
    upsertUserFromGoogle.mockClear();
    updateCalendarTokens.mockClear();
  });

  afterEach(() => {
    process.env.SUPER_ADMIN_EMAILS = originalSuperAdmins;
  });

  describe("GoogleProvider scope", () => {
    it("no longer requests calendar.readonly or offline access at login", () => {
      const provider = authOptions.providers[0] as unknown as {
        options: { authorization: { params: { scope: string; access_type?: string; prompt?: string } } };
      };
      const params = provider.options.authorization.params;
      expect(params.scope).not.toContain("calendar");
      expect(params.access_type).toBeUndefined();
      expect(params.prompt).toBe("select_account");
    });
  });

  describe("signIn callback", () => {
    it("rejects an email that is not in the allowlist and not a super admin", async () => {
      process.env.SUPER_ADMIN_EMAILS = "boss@squaads.com";
      findAuthorizedAccount.mockResolvedValueOnce(null);

      const result = await callbacks.signIn!({
        user: { id: "g-1", email: "stranger@squaads.com" },
        account: { access_token: "tok" },
      } as never);

      expect(result).toBe(false);
      expect(upsertUserFromGoogle).not.toHaveBeenCalled();
    });

    it("autoprovisions a SUPER_ADMIN_EMAILS entry as an active admin", async () => {
      process.env.SUPER_ADMIN_EMAILS = "boss@squaads.com";

      const result = await callbacks.signIn!({
        user: { id: "g-1", email: "boss@squaads.com" },
        account: { access_token: "tok" },
      } as never);

      expect(result).toBe(true);
      expect(upsertAuthorizedAccount).toHaveBeenCalledWith(
        expect.objectContaining({ email: "boss@squaads.com", role: "admin", isActive: true }),
      );
      expect(upsertUserFromGoogle).toHaveBeenCalled();
    });

    it("accepts an email already active in authorized_accounts (backfill case)", async () => {
      process.env.SUPER_ADMIN_EMAILS = "";
      findAuthorizedAccount.mockResolvedValueOnce({
        role: "member",
        isActive: true,
      });

      const result = await callbacks.signIn!({
        user: { id: "g-2", email: "existing@squaads.com" },
        account: { access_token: "tok" },
      } as never);

      expect(result).toBe(true);
      expect(upsertUserFromGoogle).toHaveBeenCalledWith({
        id: "g-2",
        name: null,
        email: "existing@squaads.com",
        image: null,
        accessToken: "tok",
        refreshToken: undefined,
        expiresAt: undefined,
      });
    });

    it("rejects a deactivated authorized account", async () => {
      process.env.SUPER_ADMIN_EMAILS = "";
      findAuthorizedAccount.mockResolvedValueOnce({
        role: "member",
        isActive: false,
      });

      const result = await callbacks.signIn!({
        user: { id: "g-3", email: "disabled@squaads.com" },
        account: { access_token: "tok" },
      } as never);

      expect(result).toBe(false);
      expect(upsertUserFromGoogle).not.toHaveBeenCalled();
    });

    it("authorizes a dev-bypass sign-in even with an email not on the allowlist", async () => {
      // Dev bypass exists to skip Google's OAuth dance entirely for local dev —
      // it must work with an invented email that was never provisioned in
      // authorized_accounts, otherwise it isn't actually a bypass.
      process.env.SUPER_ADMIN_EMAILS = "";
      findAuthorizedAccount.mockResolvedValueOnce(null);

      const result = await callbacks.signIn!({
        user: { id: "dev-bypass", email: "made-up-dev@nowhere.test" },
        account: { provider: "dev-bypass", access_token: undefined },
      } as never);

      expect(result).toBe(true);
      expect(upsertUserFromGoogle).toHaveBeenCalledWith(
        expect.objectContaining({ id: "dev-bypass", email: "made-up-dev@nowhere.test" }),
      );
    });
  });

  describe("dev auth bypass gate", () => {
    it("is disabled on production regardless of the bypass email being set", () => {
      expect(
        isDevAuthBypassEnabled({ VERCEL_ENV: "production", DEV_AUTH_BYPASS_EMAIL: "dev@squaads.com" }),
      ).toBe(false);
    });

    it("is disabled when no bypass email is configured", () => {
      expect(isDevAuthBypassEnabled({ VERCEL_ENV: "preview" })).toBe(false);
    });

    it("is enabled on preview when a bypass email is configured", () => {
      expect(
        isDevAuthBypassEnabled({ VERCEL_ENV: "preview", DEV_AUTH_BYPASS_EMAIL: "dev@squaads.com" }),
      ).toBe(true);
    });

    it("is enabled locally (no VERCEL_ENV) when a bypass email is configured", () => {
      expect(isDevAuthBypassEnabled({ DEV_AUTH_BYPASS_EMAIL: "dev@squaads.com" })).toBe(true);
    });
  });

  describe("createAuthProviders", () => {
    it("only registers GoogleProvider when the bypass is disabled", () => {
      const providers = createAuthProviders({ VERCEL_ENV: "production" });
      expect(providers).toHaveLength(1);
    });

    it("registers the dev-bypass CredentialsProvider alongside Google when enabled", () => {
      const providers = createAuthProviders({
        VERCEL_ENV: "preview",
        DEV_AUTH_BYPASS_EMAIL: "dev@squaads.com",
      });
      expect(providers).toHaveLength(2);
      expect((providers[1] as unknown as { options: { id: string } }).options.id).toBe("dev-bypass");
    });

    it("the dev-bypass provider authorizes as the configured email", async () => {
      const providers = createAuthProviders({
        VERCEL_ENV: "preview",
        DEV_AUTH_BYPASS_EMAIL: "dev@squaads.com",
      });
      const bypassProvider = providers[1] as unknown as {
        options: { authorize: () => Promise<{ email: string } | null> };
      };
      const user = await bypassProvider.options.authorize();
      expect(user).toEqual({ id: "dev-bypass", email: "dev@squaads.com", name: "Dev bypass", image: null });
    });
  });

  describe("jwt/session role propagation", () => {
    it("attaches the resolved role to the token on initial sign-in", async () => {
      findAuthorizedAccount.mockResolvedValueOnce({
        role: "admin",
        isActive: true,
      });

      const token = await callbacks.jwt!({
        token: {},
        account: { access_token: "tok", refresh_token: undefined, expires_at: undefined },
        user: { id: "g-1", email: "boss@squaads.com" },
      } as never);

      expect((token as Record<string, unknown>).role).toBe("admin");
    });

    it("grants admin role for a dev-bypass session on initial sign-in without querying the allowlist", async () => {
      const token = await callbacks.jwt!({
        token: {},
        account: { provider: "dev-bypass", access_token: undefined, refresh_token: undefined, expires_at: undefined },
        user: { id: "dev-bypass", email: "made-up-dev@nowhere.test" },
      } as never);

      expect((token as Record<string, unknown>).role).toBe("admin");
      expect(findAuthorizedAccount).not.toHaveBeenCalled();
    });

    it("keeps the dev-bypass admin role on later calls without re-querying the allowlist", async () => {
      // Simulates a request on an existing dev-bypass session: no account/user
      // (same as any carried-over token), only the isDevBypass marker set on
      // the initial sign-in call persists across requests.
      const token = await callbacks.jwt!({
        token: { userId: "dev-bypass", role: "admin", email: "made-up-dev@nowhere.test", isDevBypass: true },
        account: undefined,
        user: undefined,
      } as never);

      expect((token as Record<string, unknown>).role).toBe("admin");
      expect(findAuthorizedAccount).not.toHaveBeenCalled();
    });

    it("exposes role on session.user", async () => {
      const session = await callbacks.session!({
        session: { user: {} },
        token: { userId: "u-1", role: "member" },
      } as never);

      expect((session.user as Record<string, unknown>).role).toBe("member");
    });

    it("re-checks the allowlist on every call, not just at initial sign-in", async () => {
      // Simulates a request on an existing session (no account/user, just the
      // carried-over token) for a user who was an active admin before but has
      // since been deactivated — the token must lose the stale "admin" role
      // instead of trusting what was baked in at login time.
      findAuthorizedAccount.mockResolvedValueOnce({
        role: "admin",
        isActive: false,
      });

      const token = await callbacks.jwt!({
        token: { userId: "u-9", role: "admin", email: "exadmin@squaads.com" },
        account: undefined,
        user: undefined,
      } as never);

      expect((token as Record<string, unknown>).role).not.toBe("admin");
    });

    it("refreshes an expiring access token on the JWT without writing it to the DB", async () => {
      // The login grant is identity-only (openid/email/profile). Persisting the
      // refreshed token used to overwrite the calendar.readonly grant stored by
      // the calendar-connect flow, leaving the poller on 403 insufficient_scope
      // forever. The refreshed token now lives on the JWT and nowhere else.
      const now = 1_700_000_000_000;
      const dateNowSpy = spyOn(Date, "now").mockReturnValue(now);
      const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ access_token: "fresh", expires_in: 3600, refresh_token: "rotated" })),
      );

      try {
        const token = await callbacks.jwt!({
          token: { userId: "u-1", accessToken: "stale", refreshToken: "refresh", expiresAt: now / 1000 + 60 },
          account: undefined,
          user: undefined,
        } as never);

        expect((token as Record<string, unknown>).accessToken).toBe("fresh");
        expect((token as Record<string, unknown>).expiresAt).toBe(now / 1000 + 3600);
        expect(updateCalendarTokens).not.toHaveBeenCalled();
        expect(upsertUserFromGoogle).not.toHaveBeenCalled();
      } finally {
        fetchSpy.mockRestore();
        dateNowSpy.mockRestore();
      }
    });

    it("keeps the current token when refresh fails", async () => {
      const fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
      const consoleSpy = spyOn(console, "error").mockImplementation(() => undefined);
      const token = { userId: "u-1", accessToken: "stale", refreshToken: "refresh", expiresAt: 1 };

      try {
        const result = await callbacks.jwt!({ token, account: undefined, user: undefined } as never);

        expect(result).toBe(token);
        expect(updateCalendarTokens).not.toHaveBeenCalled();
        expect(consoleSpy).toHaveBeenCalledWith("[Auth] Token refresh failed:", expect.any(Error));
      } finally {
        fetchSpy.mockRestore();
        consoleSpy.mockRestore();
      }
    });
  });
});
