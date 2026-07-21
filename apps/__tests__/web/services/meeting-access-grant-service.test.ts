import { describe, expect, it, mock, beforeEach } from "bun:test";

type MeetingRow = { id: string; ownerId: string };
type GrantRow = {
  id: string;
  meetingId: string;
  ownerId: string;
  granteeUserId: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const state: {
  meetings: Record<string, MeetingRow>;
  grants: Record<string, GrantRow>;
  createCalls: GrantRow[];
  revokeCalls: string[];
} = { meetings: {}, grants: {}, createCalls: [], revokeCalls: [] };

function resetState() {
  state.meetings = {};
  state.grants = {};
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

bunMock.module("@meeting-bot/shared/repositories/MeetingAccessGrantRepository", () => ({
  MeetingAccessGrantRepository: {
    create: async (values: GrantRow) => {
      state.createCalls.push(values);
      state.grants[values.id] = values;
    },
    findById: async (id: string) => state.grants[id] ?? null,
    listByMeetingId: async (meetingId: string) =>
      Object.values(state.grants).filter((g) => g.meetingId === meetingId),
    revokeById: async (id: string) => {
      state.revokeCalls.push(id);
    },
  },
}));

const { MeetingAccessGrantService } = await import("../../../../apps/web/src/services/meetingAccessGrantService");

describe("MeetingAccessGrantService", () => {
  beforeEach(() => {
    resetState();
    state.meetings["meeting-1"] = { id: "meeting-1", ownerId: "owner-1" };
  });

  describe("createGrant", () => {
    it("owner can create a grant", async () => {
      const result = await MeetingAccessGrantService.createGrant({
        callerId: "owner-1",
        meetingId: "meeting-1",
        granteeUserId: "grantee-1",
      });

      expect(state.createCalls).toHaveLength(1);
      expect(state.createCalls[0]?.granteeUserId).toBe("grantee-1");
      expect(state.createCalls[0]?.ownerId).toBe("owner-1");
      expect(result.id).toBeTruthy();
    });

    it("rejects a non-owner caller (no re-sharing chains)", async () => {
      await expect(
        MeetingAccessGrantService.createGrant({
          callerId: "grantee-1",
          meetingId: "meeting-1",
          granteeUserId: "grantee-2",
        })
      ).rejects.toThrow();

      expect(state.createCalls).toHaveLength(0);
    });

    it("rejects when the meeting does not exist", async () => {
      await expect(
        MeetingAccessGrantService.createGrant({
          callerId: "owner-1",
          meetingId: "nope",
          granteeUserId: "grantee-1",
        })
      ).rejects.toThrow();
    });

    it("resolves a TTL from the configured menu", async () => {
      const result = await MeetingAccessGrantService.createGrant({
        callerId: "owner-1",
        meetingId: "meeting-1",
        granteeUserId: "grantee-1",
        ttlMinutes: 60,
      });

      expect(result.expiresAt).not.toBeNull();
      expect(result.expiresAt!.getTime()).toBeGreaterThan(Date.now());
    });

    it("no-expiry option yields a null expiresAt", async () => {
      const result = await MeetingAccessGrantService.createGrant({
        callerId: "owner-1",
        meetingId: "meeting-1",
        granteeUserId: "grantee-1",
        noExpiry: true,
      });

      expect(result.expiresAt).toBeNull();
    });

    it("rejects a ttlMinutes value outside the configured menu", async () => {
      await expect(
        MeetingAccessGrantService.createGrant({
          callerId: "owner-1",
          meetingId: "meeting-1",
          granteeUserId: "grantee-1",
          ttlMinutes: 42,
        })
      ).rejects.toThrow();
    });
  });

  describe("listGrantsByMeetingId", () => {
    it("owner can list grants", async () => {
      state.grants["grant-1"] = {
        id: "grant-1",
        meetingId: "meeting-1",
        ownerId: "owner-1",
        granteeUserId: "grantee-1",
        expiresAt: null,
        revokedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = await MeetingAccessGrantService.listGrantsByMeetingId("owner-1", "meeting-1");
      expect(result).toHaveLength(1);
    });

    it("rejects a non-owner caller", async () => {
      await expect(MeetingAccessGrantService.listGrantsByMeetingId("grantee-1", "meeting-1")).rejects.toThrow();
    });
  });

  describe("revokeGrant", () => {
    it("owner can revoke a grant", async () => {
      state.grants["grant-1"] = {
        id: "grant-1",
        meetingId: "meeting-1",
        ownerId: "owner-1",
        granteeUserId: "grantee-1",
        expiresAt: null,
        revokedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await MeetingAccessGrantService.revokeGrant({ callerId: "owner-1", grantId: "grant-1" });
      expect(state.revokeCalls).toEqual(["grant-1"]);
    });

    it("rejects a non-owner caller", async () => {
      state.grants["grant-1"] = {
        id: "grant-1",
        meetingId: "meeting-1",
        ownerId: "owner-1",
        granteeUserId: "grantee-1",
        expiresAt: null,
        revokedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await expect(
        MeetingAccessGrantService.revokeGrant({ callerId: "grantee-1", grantId: "grant-1" })
      ).rejects.toThrow();
      expect(state.revokeCalls).toHaveLength(0);
    });

    it("rejects when the grant does not exist", async () => {
      await expect(
        MeetingAccessGrantService.revokeGrant({ callerId: "owner-1", grantId: "nope" })
      ).rejects.toThrow();
    });
  });
});
