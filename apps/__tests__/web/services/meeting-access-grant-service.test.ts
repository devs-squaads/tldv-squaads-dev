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

// Overridden per-test to simulate Postgres onConflictDoUpdate returning the
// pre-existing row (with its own id) instead of the row passed in.
let upsertActiveImpl = async (values: GrantRow): Promise<GrantRow> => {
  state.createCalls.push(values);
  state.grants[values.id] = values;
  return values;
};

bunMock.module("@meeting-bot/shared/repositories/MeetingRepository", () => ({
  MeetingRepository: {
    findById: async (id: string) => state.meetings[id] ?? null,
  },
}));

bunMock.module("@meeting-bot/shared/repositories/MeetingAccessGrantRepository", () => ({
  MeetingAccessGrantRepository: {
    upsertActive: async (values: GrantRow) => upsertActiveImpl(values),
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
    upsertActiveImpl = async (values: GrantRow) => {
      state.createCalls.push(values);
      state.grants[values.id] = values;
      return values;
    };
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

    it("returns the persisted row's id when upsertActive resolves an existing grant (onConflictDoUpdate)", async () => {
      const existingId = "pre-existing-grant-id";
      upsertActiveImpl = async (values: GrantRow) => {
        // Simulates Postgres onConflictDoUpdate({ target: [meetingId, granteeUserId] }):
        // the DB returns the EXISTING row, keyed by its own original id, not the
        // freshly generated id the service passed in.
        const persisted: GrantRow = { ...values, id: existingId };
        state.createCalls.push(values);
        state.grants[existingId] = persisted;
        return persisted;
      };

      const result = await MeetingAccessGrantService.createGrant({
        callerId: "owner-1",
        meetingId: "meeting-1",
        granteeUserId: "grantee-1",
      });

      expect(result.id).toBe(existingId);
      expect(state.grants[result.id]).toBeTruthy();
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

    // 013/Phase 4.2: accessType maps straight to an expiry, bypassing shareTtl.ts's fixed
    // TTL-menu validation exercised above — Share Request approvals need any day count, not
    // just 60/1440/10080. These tests use the REAL (unmocked) resolveExpiresAt/shareTtl.ts,
    // so they prove the fix at the exact spot the original bug threw at runtime.
    describe("accessType mapping (013)", () => {
      it("temporary honors an arbitrary day count (15 days) the configured menu does not contain", async () => {
        const result = await MeetingAccessGrantService.createGrant({
          callerId: "owner-1",
          meetingId: "meeting-1",
          granteeUserId: "grantee-1",
          accessType: "temporary",
          expiresInDays: 15,
        });

        expect(result.expiresAt).not.toBeNull();
        const expectedMs = 15 * 1440 * 60 * 1000;
        const deltaMs = result.expiresAt!.getTime() - Date.now();
        expect(deltaMs).toBeGreaterThan(expectedMs - 5000);
        expect(deltaMs).toBeLessThanOrEqual(expectedMs);
      });

      it("temporary honors a 47-day count too, not just a value that happens to divide evenly", async () => {
        const result = await MeetingAccessGrantService.createGrant({
          callerId: "owner-1",
          meetingId: "meeting-1",
          granteeUserId: "grantee-1",
          accessType: "temporary",
          expiresInDays: 47,
        });

        expect(result.expiresAt).not.toBeNull();
        const expectedMs = 47 * 1440 * 60 * 1000;
        const deltaMs = result.expiresAt!.getTime() - Date.now();
        expect(deltaMs).toBeGreaterThan(expectedMs - 5000);
        expect(deltaMs).toBeLessThanOrEqual(expectedMs);
      });

      it("temporary without expiresInDays is rejected", async () => {
        await expect(
          MeetingAccessGrantService.createGrant({
            callerId: "owner-1",
            meetingId: "meeting-1",
            granteeUserId: "grantee-1",
            accessType: "temporary",
          })
        ).rejects.toThrow();
      });

      it("permanent maps to a null expiresAt", async () => {
        const result = await MeetingAccessGrantService.createGrant({
          callerId: "owner-1",
          meetingId: "meeting-1",
          granteeUserId: "grantee-1",
          accessType: "permanent",
        });

        expect(result.expiresAt).toBeNull();
      });

      it("single_use is rejected — registered recipients only get temporary/permanent", async () => {
        await expect(
          MeetingAccessGrantService.createGrant({
            callerId: "owner-1",
            meetingId: "meeting-1",
            granteeUserId: "grantee-1",
            accessType: "single_use",
          })
        ).rejects.toThrow();
      });
    });

    describe("callerRole guard (013)", () => {
      it("member callerRole cannot create a grant directly", async () => {
        await expect(
          MeetingAccessGrantService.createGrant({
            callerId: "owner-1",
            meetingId: "meeting-1",
            granteeUserId: "grantee-1",
            callerRole: "member",
          })
        ).rejects.toThrow();
        expect(state.createCalls).toHaveLength(0);
      });

      it("admin callerRole can create a grant directly", async () => {
        const result = await MeetingAccessGrantService.createGrant({
          callerId: "owner-1",
          meetingId: "meeting-1",
          granteeUserId: "grantee-1",
          callerRole: "admin",
        });
        expect(result.id).toBeTruthy();
      });

      it("undefined callerRole (M2M) is unaffected", async () => {
        const result = await MeetingAccessGrantService.createGrant({
          callerId: "owner-1",
          meetingId: "meeting-1",
          granteeUserId: "grantee-1",
        });
        expect(result.id).toBeTruthy();
      });
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
