import { describe, expect, it, mock, beforeEach } from "bun:test";

type MeetingRow = { id: string; ownerId: string; status: string };
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
} = { meetings: {}, shares: {}, createCalls: [], revokeCalls: [] };

function resetState() {
  state.meetings = {};
  state.shares = {};
  state.createCalls = [];
  state.revokeCalls = [];
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
    revokeById: async (id: string) => {
      state.revokeCalls.push(id);
    },
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
});
