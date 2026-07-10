/// <reference types="bun" />

import { describe, expect, it, spyOn, beforeEach, afterEach } from "bun:test";
import { UserRepository } from "../../../web/src/repositories/UserRepository";
import { AuthorizedAccountRepository } from "../../../../packages/shared/src/repositories/AuthorizedAccountRepository";

// auth.ts resolves UserRepository/AuthorizedAccountRepository via their real,
// unmocked modules (same resolved path as the imports above), so spying on
// the exported class' static methods intercepts every caller — this avoids
// bun's mock.module() collisions with AuthorizedAccountRepository.test.ts and
// UserRepository.test.ts, which need the real classes (see
// apps/__tests__/helpers/dbSchemaMock.ts for the deep dive). This file lives
// under routes/ (not directly under web/) so it sorts, and therefore loads,
// AFTER apps/__tests__/web/repositories/*.test.ts — those establish the real
// classes' db/schema/drizzle-orm bindings first; this file never needs them
// since every dependency call here goes through spyOn.
const { authOptions } = await import("../../../web/src/auth");

const originalSuperAdmins = process.env.SUPER_ADMIN_EMAILS;

describe("auth.ts allowlist gate", () => {
  let upsertFromGoogleSpy: ReturnType<typeof spyOn>;
  let findByEmailSpy: ReturnType<typeof spyOn>;
  let upsertSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    upsertFromGoogleSpy = spyOn(UserRepository, "upsertFromGoogle").mockResolvedValue({} as never);
    findByEmailSpy = spyOn(AuthorizedAccountRepository, "findByEmail").mockResolvedValue(null as never);
    upsertSpy = spyOn(AuthorizedAccountRepository, "upsert").mockImplementation(
      (input: Record<string, unknown>) => Promise.resolve({ ...input, id: "acc-1" } as never),
    );
  });

  afterEach(() => {
    process.env.SUPER_ADMIN_EMAILS = originalSuperAdmins;
    upsertFromGoogleSpy.mockRestore();
    findByEmailSpy.mockRestore();
    upsertSpy.mockRestore();
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
      findByEmailSpy.mockResolvedValueOnce(null as never);

      const result = await authOptions.callbacks!.signIn!({
        user: { id: "g-1", email: "stranger@squaads.com" },
        account: { access_token: "tok" },
      } as never);

      expect(result).toBe(false);
      expect(upsertFromGoogleSpy).not.toHaveBeenCalled();
    });

    it("autoprovisions a SUPER_ADMIN_EMAILS entry as an active admin", async () => {
      process.env.SUPER_ADMIN_EMAILS = "boss@squaads.com";

      const result = await authOptions.callbacks!.signIn!({
        user: { id: "g-1", email: "boss@squaads.com" },
        account: { access_token: "tok" },
      } as never);

      expect(result).toBe(true);
      expect(upsertSpy).toHaveBeenCalledWith(
        expect.objectContaining({ email: "boss@squaads.com", role: "admin", isActive: true }),
      );
      expect(upsertFromGoogleSpy).toHaveBeenCalled();
    });

    it("accepts an email already active in authorized_accounts (backfill case)", async () => {
      process.env.SUPER_ADMIN_EMAILS = "";
      findByEmailSpy.mockResolvedValueOnce({
        id: "acc-2",
        email: "existing@squaads.com",
        role: "member",
        isActive: true,
      } as never);

      const result = await authOptions.callbacks!.signIn!({
        user: { id: "g-2", email: "existing@squaads.com" },
        account: { access_token: "tok" },
      } as never);

      expect(result).toBe(true);
      expect(upsertFromGoogleSpy).toHaveBeenCalled();
    });

    it("rejects a deactivated authorized account", async () => {
      process.env.SUPER_ADMIN_EMAILS = "";
      findByEmailSpy.mockResolvedValueOnce({
        id: "acc-3",
        email: "disabled@squaads.com",
        role: "member",
        isActive: false,
      } as never);

      const result = await authOptions.callbacks!.signIn!({
        user: { id: "g-3", email: "disabled@squaads.com" },
        account: { access_token: "tok" },
      } as never);

      expect(result).toBe(false);
      expect(upsertFromGoogleSpy).not.toHaveBeenCalled();
    });
  });

  describe("jwt/session role propagation", () => {
    it("attaches the resolved role to the token on initial sign-in", async () => {
      findByEmailSpy.mockResolvedValueOnce({
        role: "admin",
        isActive: true,
        email: "boss@squaads.com",
      } as never);

      const token = await authOptions.callbacks!.jwt!({
        token: {},
        account: { access_token: "tok", refresh_token: undefined, expires_at: undefined },
        user: { id: "g-1", email: "boss@squaads.com" },
      } as never);

      expect((token as Record<string, unknown>).role).toBe("admin");
    });

    it("exposes role on session.user", async () => {
      const session = await authOptions.callbacks!.session!({
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
      findByEmailSpy.mockResolvedValueOnce({
        email: "exadmin@squaads.com",
        role: "admin",
        isActive: false,
      } as never);

      const token = await authOptions.callbacks!.jwt!({
        token: { userId: "u-9", role: "admin", email: "exadmin@squaads.com" },
        account: undefined,
        user: undefined,
      } as never);

      expect((token as Record<string, unknown>).role).not.toBe("admin");
    });
  });
});
