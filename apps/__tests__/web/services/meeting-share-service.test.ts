import { describe, expect, it, mock, beforeEach } from "bun:test";
import { buildShareAliasToken } from "../../../../apps/web/src/integrations/sharing/utils";

type MeetingRow = {
  id: string;
  ownerId: string;
  status: string;
  url?: string;
  recordingFilePath?: string | null;
  recordingStorageKey?: string | null;
  summary?: string | null;
  rawTranscription?: string | null;
  createdAt?: Date;
};
type ShareRow = {
  id: string;
  meetingId: string;
  shareType: string;
  tokenHash: string;
  recipientEmail: string | null;
  recipientEmailNormalized: string | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdBy: string | null;
  otpHash: string | null;
  otpExpiresAt: Date | null;
  lastAccessedAt: Date | null;
  singleUse?: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const state: {
  meetings: Record<string, MeetingRow>;
  shares: Record<string, ShareRow>;
  createCalls: ShareRow[];
  revokeCalls: string[];
  signCalls: string[];
  accessLogs: string[];
} = { meetings: {}, shares: {}, createCalls: [], revokeCalls: [], signCalls: [], accessLogs: [] };

function resetState() {
  state.meetings = {};
  state.shares = {};
  state.createCalls = [];
  state.revokeCalls = [];
  state.signCalls = [];
  state.accessLogs = [];
}

const bunMock = mock as typeof mock & {
  module: (specifier: string, factory: () => unknown) => void;
};

bunMock.module("@meeting-bot/shared/repositories/MeetingRepository", () => ({
  MeetingRepository: {
    findById: async (id: string) => state.meetings[id] ?? null,
  },
}));

bunMock.module("@/repositories/MeetingShareRepository", () => ({
  MeetingShareRepository: {
    create: async (values: ShareRow) => {
      state.createCalls.push(values);
      state.shares[values.id] = values;
    },
    findById: async (id: string) => state.shares[id] ?? null,
    findByTokenHash: async (tokenHash: string) =>
      Object.values(state.shares).find((s) => s.tokenHash === tokenHash) ?? null,
    revokeById: async (id: string) => {
      state.revokeCalls.push(id);
      const share = state.shares[id];
      if (share) {
        share.revokedAt = new Date();
      }
    },
    markAccessed: async () => {},
    insertAccessLog: async (entry: { result: string }) => {
      state.accessLogs.push(entry.result);
    },
  },
}));

bunMock.module("@/integrations/sharing/SharingProviderFactory", () => ({
  SharingProviderFactory: {
    getProvider: () => ({
      verifyAccess: async () => true,
    }),
  },
}));

bunMock.module("@meeting-bot/shared/integrations/storage/StorageProviderFactory", () => ({
  StorageProviderFactory: {
    getProvider: () => ({
      getSignedUrl: async (key: string) => {
        state.signCalls.push(key);
        return `signed:${key}`;
      },
    }),
  },
}));

const { MeetingShareService } = await import("../../../../apps/web/src/services/meetingShareService");

describe("MeetingShareService", () => {
  beforeEach(() => {
    resetState();
    state.meetings["meeting-1"] = { id: "meeting-1", ownerId: "owner-1", status: "completed" };
  });

  describe("createShare", () => {
    it("owner can create a restricted_email share", async () => {
      const result = await MeetingShareService.createShare(
        { meetingId: "meeting-1", shareType: "restricted_email", recipientEmail: "guest@example.com" },
        "owner-1"
      );

      expect(state.createCalls).toHaveLength(1);
      expect(result.shareType).toBe("restricted_email");
    });

    it("rejects a non-owner caller", async () => {
      await expect(
        MeetingShareService.createShare(
          { meetingId: "meeting-1", shareType: "restricted_email", recipientEmail: "guest@example.com" },
          "intruder-1"
        )
      ).rejects.toThrow();

      expect(state.createCalls).toHaveLength(0);
    });

    it("rejects the 'public' shareType even for the owner", async () => {
      await expect(
        MeetingShareService.createShare(
          // @ts-expect-error - "public" is being phased out (Phase 6 drops the type); runtime must reject it now.
          { meetingId: "meeting-1", shareType: "public" },
          "owner-1"
        )
      ).rejects.toThrow();

      expect(state.createCalls).toHaveLength(0);
    });

    // 013/Phase 4.1: defense-in-depth role guard — the action layer already routes member
    // Owners to a Share Request, this protects non-action callers (e.g. the chat tool) too.
    describe("callerRole guard (013)", () => {
      it("rejects a member callerRole even for the owner", async () => {
        await expect(
          MeetingShareService.createShare(
            { meetingId: "meeting-1", shareType: "restricted_email", recipientEmail: "guest@example.com" },
            "owner-1",
            "member"
          )
        ).rejects.toThrow();

        expect(state.createCalls).toHaveLength(0);
      });

      it("admin callerRole can create directly", async () => {
        const result = await MeetingShareService.createShare(
          { meetingId: "meeting-1", shareType: "restricted_email", recipientEmail: "guest@example.com" },
          "owner-1",
          "admin"
        );

        expect(result.shareType).toBe("restricted_email");
      });

      it("undefined callerRole (M2M) is unaffected", async () => {
        const result = await MeetingShareService.createShare(
          { meetingId: "meeting-1", shareType: "restricted_email", recipientEmail: "guest@example.com" },
          "owner-1"
        );

        expect(result.shareType).toBe("restricted_email");
      });
    });

    describe("singleUse (013)", () => {
      it("persists singleUse: true when requested", async () => {
        await MeetingShareService.createShare(
          {
            meetingId: "meeting-1",
            shareType: "restricted_email",
            recipientEmail: "guest@example.com",
            singleUse: true,
          },
          "owner-1"
        );

        expect(state.createCalls[0]?.singleUse).toBe(true);
      });

      it("defaults singleUse to false when not requested", async () => {
        await MeetingShareService.createShare(
          { meetingId: "meeting-1", shareType: "restricted_email", recipientEmail: "guest@example.com" },
          "owner-1"
        );

        expect(state.createCalls[0]?.singleUse).toBe(false);
      });
    });

    // 013/Phase 4.2 follow-up (PR3 fix): mirrors meetingAccessGrantService's
    // "accessType mapping (013)" suite, but for the unregistered-recipient path
    // (createShare), which had the identical resolveExpiresAt()/fixed-menu bug still open.
    // These run against the REAL (unmocked) resolveExpiresAt/shareTtl.ts.
    describe("accessType mapping (013)", () => {
      it("temporary honors an arbitrary day count (23 days) the configured menu does not contain", async () => {
        const result = await MeetingShareService.createShare(
          {
            meetingId: "meeting-1",
            shareType: "restricted_email",
            recipientEmail: "guest@example.com",
            accessType: "temporary",
            expiresInDays: 23,
          },
          "owner-1"
        );

        expect(result.expiresAt).not.toBeNull();
        const expectedMs = 23 * 1440 * 60 * 1000;
        const deltaMs = result.expiresAt!.getTime() - Date.now();
        expect(deltaMs).toBeGreaterThan(expectedMs - 5000);
        expect(deltaMs).toBeLessThanOrEqual(expectedMs);
      });

      it("temporary honors a 90-day count too, not just a value that happens to divide evenly", async () => {
        const result = await MeetingShareService.createShare(
          {
            meetingId: "meeting-1",
            shareType: "restricted_email",
            recipientEmail: "guest@example.com",
            accessType: "temporary",
            expiresInDays: 90,
          },
          "owner-1"
        );

        expect(result.expiresAt).not.toBeNull();
        const expectedMs = 90 * 1440 * 60 * 1000;
        const deltaMs = result.expiresAt!.getTime() - Date.now();
        expect(deltaMs).toBeGreaterThan(expectedMs - 5000);
        expect(deltaMs).toBeLessThanOrEqual(expectedMs);
      });

      it("temporary without expiresInDays is rejected", async () => {
        await expect(
          MeetingShareService.createShare(
            {
              meetingId: "meeting-1",
              shareType: "restricted_email",
              recipientEmail: "guest@example.com",
              accessType: "temporary",
            },
            "owner-1"
          )
        ).rejects.toThrow();
      });

      it("permanent accessType maps to a null expiresAt", async () => {
        const result = await MeetingShareService.createShare(
          {
            meetingId: "meeting-1",
            shareType: "restricted_email",
            recipientEmail: "guest@example.com",
            accessType: "permanent",
          },
          "owner-1"
        );

        expect(result.expiresAt).toBeNull();
      });

      // Regression guard: single_use must NOT be conflated with this mechanism — it is
      // resolved via the existing singleUse boolean field, untouched by this fix.
      it("accessType single_use does not conflict with the singleUse field path", async () => {
        const result = await MeetingShareService.createShare(
          {
            meetingId: "meeting-1",
            shareType: "restricted_email",
            recipientEmail: "guest@example.com",
            accessType: "single_use",
            singleUse: true,
          },
          "owner-1"
        );

        expect(result.expiresAt).toBeNull();
        expect(state.createCalls[0]?.singleUse).toBe(true);
      });
    });
  });

  describe("revokeShare", () => {
    beforeEach(() => {
      state.shares["share-1"] = {
        id: "share-1",
        meetingId: "meeting-1",
        shareType: "restricted_email",
        tokenHash: "hash",
        recipientEmail: null,
        recipientEmailNormalized: null,
        expiresAt: null,
        revokedAt: null,
        createdBy: null,
        otpHash: null,
        otpExpiresAt: null,
        lastAccessedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    });

    it("owner can revoke a share", async () => {
      await MeetingShareService.revokeShare("share-1", "owner-1");
      expect(state.revokeCalls).toEqual(["share-1"]);
    });

    it("rejects a non-owner caller", async () => {
      await expect(MeetingShareService.revokeShare("share-1", "intruder-1")).rejects.toThrow();
      expect(state.revokeCalls).toHaveLength(0);
    });
  });

  describe("verifyRestrictedAccess", () => {
    const SHARE_UUID = "11111111-1111-4111-8111-111111111111"; // parseShareAliasToken requires a real UUID shape

    function seedActiveShare(tokenHash: string) {
      state.shares[SHARE_UUID] = {
        id: SHARE_UUID,
        meetingId: "meeting-1",
        shareType: "restricted_email",
        tokenHash,
        recipientEmail: "guest@example.com",
        recipientEmailNormalized: "guest@example.com",
        expiresAt: null,
        revokedAt: null,
        createdBy: "owner-1",
        otpHash: null,
        otpExpiresAt: null,
        lastAccessedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      return buildShareAliasToken(SHARE_UUID, tokenHash);
    }

    it("signs the meeting's persisted recordingStorageKey, not the recomputed legacy key", async () => {
      state.meetings["meeting-1"] = {
        id: "meeting-1",
        ownerId: "owner-1",
        status: "completed",
        url: "https://meet.google.com/abc-defg-hij",
        recordingFilePath: "http://localhost:9000/meetings/google-meet/meeting_2026-07-22_meeting-1.mp4",
        recordingStorageKey: "google-meet/meeting_2026-07-22_meeting-1.mp4",
      };
      const token = seedActiveShare("a".repeat(64));

      const result = await MeetingShareService.verifyRestrictedAccess(token, "guest@example.com", "123456");

      expect(result.status).toBe("ok");
      expect(state.signCalls).toEqual(["google-meet/meeting_2026-07-22_meeting-1.mp4"]);
    });

    it("falls back to the legacy computed key when recordingStorageKey is null", async () => {
      state.meetings["meeting-1"] = {
        id: "meeting-1",
        ownerId: "owner-1",
        status: "completed",
        url: "https://meet.google.com/abc-defg-hij",
        recordingFilePath: "http://localhost:9000/meetings/google-meet/meeting-1.mp4",
        recordingStorageKey: null,
      };
      const token = seedActiveShare("b".repeat(64));

      await MeetingShareService.verifyRestrictedAccess(token, "guest@example.com", "123456");

      expect(state.signCalls).toEqual(["google-meet/meeting-1.mp4"]);
    });

    // 013/Phase 4.1: singleUse dies on first successful verify (reuses revokedAt, ADR-0008).
    it("revokes a singleUse share on the first successful verify and blocks a second attempt", async () => {
      const SINGLE_USE_UUID = "22222222-2222-4222-8222-222222222222";
      state.shares[SINGLE_USE_UUID] = {
        id: SINGLE_USE_UUID,
        meetingId: "meeting-1",
        shareType: "restricted_email",
        tokenHash: "d".repeat(64),
        recipientEmail: "guest@example.com",
        recipientEmailNormalized: "guest@example.com",
        expiresAt: null,
        revokedAt: null,
        createdBy: "owner-1",
        otpHash: null,
        otpExpiresAt: null,
        lastAccessedAt: null,
        singleUse: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const token = buildShareAliasToken(SINGLE_USE_UUID, "d".repeat(64));

      const first = await MeetingShareService.verifyRestrictedAccess(token, "guest@example.com", "123456");
      expect(first.status).toBe("ok");
      expect(state.revokeCalls).toEqual([SINGLE_USE_UUID]);

      const second = await MeetingShareService.verifyRestrictedAccess(token, "guest@example.com", "123456");
      expect(second.status).toBe("not_found");
    });

    it("does not revoke a non-singleUse share after a successful verify", async () => {
      const token = seedActiveShare("e".repeat(64));

      await MeetingShareService.verifyRestrictedAccess(token, "guest@example.com", "123456");

      expect(state.revokeCalls).toHaveLength(0);
    });
  });
});
