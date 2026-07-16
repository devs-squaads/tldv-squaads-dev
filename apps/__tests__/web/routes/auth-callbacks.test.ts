/// <reference types="bun" />

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { authOptions, createAuthCallbacks } from "../../../web/src/auth";

const originalSuperAdmins = process.env.SUPER_ADMIN_EMAILS;

describe("auth.ts allowlist gate", () => {
  const findAuthorizedAccount = mock(async () => null);
  const upsertAuthorizedAccount = mock(async (input: { role: "admin" | "member"; isActive: boolean }) => ({
    role: input.role,
    isActive: input.isActive,
  }));
  const upsertUserFromGoogle = mock(async () => undefined);
  const updateCalendarTokens = mock(async () => undefined);

  const callbacks = createAuthCallbacks({
    findAuthorizedAccount,
    upsertAuthorizedAccount,
    upsertUserFromGoogle,
    updateCalendarTokens,
  });

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

    it("refreshes an expiring access token and persists rotated tokens", async () => {
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
        expect(updateCalendarTokens).toHaveBeenCalledWith("u-1", {
          accessToken: "fresh",
          expiresAt: now / 1000 + 3600,
          refreshToken: "rotated",
        });
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
