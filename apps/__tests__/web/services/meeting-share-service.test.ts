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
  });
});
