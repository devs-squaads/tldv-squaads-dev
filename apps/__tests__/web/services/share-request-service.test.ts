import { describe, expect, it, mock, beforeEach } from "bun:test";

type MeetingRow = { id: string; ownerId: string };
type ShareRequestRow = {
  id: string;
  meetingId: string;
  requesterId: string;
  granteeUserId: string | null;
  recipientEmail: string | null;
  recipientEmailNormalized: string | null;
  accessType: "single_use" | "temporary" | "permanent";
  expiresInDays: number | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  resolvedBy: string | null;
  resolvedAt: Date | null;
  resolvedGrantId: string | null;
  resolvedShareId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const state: {
  meetings: Record<string, MeetingRow>;
  requests: Record<string, ShareRequestRow>;
  createCalls: ShareRequestRow[];
  resolveCalls: { id: string; input: Record<string, unknown> }[];
  cancelCalls: string[];
  deleteCalls: string[];
  deleteResolvedCalls: string[];
  grantCalls: Record<string, unknown>[];
  shareCalls: { input: Record<string, unknown>; callerId?: string }[];
} = {
  meetings: {},
  requests: {},
  createCalls: [],
  resolveCalls: [],
  cancelCalls: [],
  deleteCalls: [],
  deleteResolvedCalls: [],
  grantCalls: [],
  shareCalls: [],
};

function resetState() {
  state.meetings = {};
  state.requests = {};
  state.createCalls = [];
  state.resolveCalls = [];
  state.cancelCalls = [];
  state.deleteCalls = [];
  state.deleteResolvedCalls = [];
  state.grantCalls = [];
  state.shareCalls = [];
}

const bunMock = mock as typeof mock & {
  module: (specifier: string, factory: () => unknown) => void;
};

bunMock.module("@meeting-bot/shared/repositories/MeetingRepository", () => ({
  MeetingRepository: {
    findById: async (id: string) => state.meetings[id] ?? null,
  },
}));

bunMock.module("@meeting-bot/shared/repositories/MeetingShareRequestRepository", () => ({
  MeetingShareRequestRepository: {
    create: async (values: ShareRequestRow) => {
      // Simulates the DB's partial-unique-index arbiter: a pending row already exists for
      // the same recipient on this meeting.
      const duplicate = Object.values(state.requests).some(
        (r) =>
          r.status === "pending" &&
          r.meetingId === values.meetingId &&
          ((values.granteeUserId && r.granteeUserId === values.granteeUserId) ||
            (values.recipientEmailNormalized && r.recipientEmailNormalized === values.recipientEmailNormalized))
      );
      if (duplicate) {
        throw new Error("duplicate key value violates unique constraint");
      }
      state.createCalls.push(values);
      state.requests[values.id] = values;
    },
    findById: async (id: string) => state.requests[id] ?? null,
    listPending: async () => Object.values(state.requests).filter((r) => r.status === "pending"),
    countPending: async () => Object.values(state.requests).filter((r) => r.status === "pending").length,
    listByMeetingId: async (meetingId: string) => Object.values(state.requests).filter((r) => r.meetingId === meetingId),
    resolve: async (id: string, input: Record<string, unknown>) => {
      state.resolveCalls.push({ id, input });
      const row = state.requests[id];
      if (row) {
        state.requests[id] = {
          ...row,
          status: input.status as ShareRequestRow["status"],
          resolvedBy: (input.resolvedBy as string | null) ?? null,
          resolvedGrantId: (input.resolvedGrantId as string | null) ?? null,
          resolvedShareId: (input.resolvedShareId as string | null) ?? null,
          resolvedAt: new Date(),
        };
      }
    },
    cancel: async (id: string) => {
      state.cancelCalls.push(id);
      const row = state.requests[id];
      if (row) {
        state.requests[id] = { ...row, status: "cancelled", resolvedAt: new Date() };
      }
    },
    deleteById: async (id: string) => {
      state.deleteCalls.push(id);
      delete state.requests[id];
    },
    deleteResolvedByMeetingId: async (meetingId: string) => {
      state.deleteResolvedCalls.push(meetingId);
      const toDelete = Object.values(state.requests).filter(
        (r) => r.meetingId === meetingId && r.status !== "pending"
      );
      toDelete.forEach((r) => delete state.requests[r.id]);
      return toDelete.length;
    },
  },
}));

bunMock.module("@/services/meetingAccessGrantService", () => ({
  MeetingAccessGrantService: {
    createGrant: async (input: Record<string, unknown>) => {
      state.grantCalls.push(input);
      return { id: "grant-1", expiresAt: input.noExpiry ? null : new Date() };
    },
  },
}));

bunMock.module("@/services/meetingShareService", () => ({
  MeetingShareService: {
    createShare: async (input: Record<string, unknown>, callerId?: string) => {
      state.shareCalls.push({ input, callerId });
      return {
        id: "share-1",
        shareType: "restricted_email",
        recipientEmail: (input.recipientEmail as string | undefined) ?? null,
        expiresAt: null,
        shareUrl: "https://example.com/share-1",
      };
    },
  },
}));

const { ShareRequestService } = await import("../../../../apps/web/src/services/shareRequestService");

function seedPendingRequest(overrides: Partial<ShareRequestRow> = {}): ShareRequestRow {
  const row: ShareRequestRow = {
    id: overrides.id ?? "request-1",
    meetingId: "meeting-1",
    requesterId: "owner-1",
    granteeUserId: "grantee-1",
    recipientEmail: null,
    recipientEmailNormalized: null,
    accessType: "permanent",
    expiresInDays: null,
    status: "pending",
    resolvedBy: null,
    resolvedAt: null,
    resolvedGrantId: null,
    resolvedShareId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  state.requests[row.id] = row;
  return row;
}

describe("ShareRequestService", () => {
  beforeEach(() => {
    resetState();
    state.meetings["meeting-1"] = { id: "meeting-1", ownerId: "owner-1" };
  });

  describe("createShareRequest", () => {
    it("member owner creates a pending request", async () => {
      const result = await ShareRequestService.createShareRequest({
        callerId: "owner-1",
        meetingId: "meeting-1",
        recipient: { granteeUserId: "grantee-1" },
        accessType: "permanent",
      });

      expect(state.createCalls).toHaveLength(1);
      expect(result.status).toBe("pending");
      expect(result.granteeUserId).toBe("grantee-1");
    });

    it("rejects a non-owner caller", async () => {
      await expect(
        ShareRequestService.createShareRequest({
          callerId: "intruder-1",
          meetingId: "meeting-1",
          recipient: { granteeUserId: "grantee-1" },
          accessType: "permanent",
        })
      ).rejects.toThrow();

      expect(state.createCalls).toHaveLength(0);
    });

    it("rejects single_use for a registered recipient", async () => {
      await expect(
        ShareRequestService.createShareRequest({
          callerId: "owner-1",
          meetingId: "meeting-1",
          recipient: { granteeUserId: "grantee-1" },
          accessType: "single_use",
        })
      ).rejects.toThrow();

      expect(state.createCalls).toHaveLength(0);
    });

    it("rejects temporary without expiresInDays", async () => {
      await expect(
        ShareRequestService.createShareRequest({
          callerId: "owner-1",
          meetingId: "meeting-1",
          recipient: { email: "guest@example.com" },
          accessType: "temporary",
        })
      ).rejects.toThrow();

      expect(state.createCalls).toHaveLength(0);
    });

    it("rejects a duplicate pending request for the same recipient", async () => {
      await ShareRequestService.createShareRequest({
        callerId: "owner-1",
        meetingId: "meeting-1",
        recipient: { granteeUserId: "grantee-1" },
        accessType: "permanent",
      });

      await expect(
        ShareRequestService.createShareRequest({
          callerId: "owner-1",
          meetingId: "meeting-1",
          recipient: { granteeUserId: "grantee-1" },
          accessType: "temporary",
          expiresInDays: 15,
        })
      ).rejects.toThrow();

      expect(state.createCalls).toHaveLength(1);
    });
  });

  describe("cancelShareRequest", () => {
    it("the requester can cancel their own pending request", async () => {
      seedPendingRequest();
      await ShareRequestService.cancelShareRequest("owner-1", "request-1");
      expect(state.cancelCalls).toEqual(["request-1"]);
    });

    it("rejects a non-requester", async () => {
      seedPendingRequest();
      await expect(ShareRequestService.cancelShareRequest("someone-else", "request-1")).rejects.toThrow();
      expect(state.cancelCalls).toHaveLength(0);
    });

    it("rejects a non-pending request", async () => {
      seedPendingRequest({ status: "approved" });
      await expect(ShareRequestService.cancelShareRequest("owner-1", "request-1")).rejects.toThrow();
      expect(state.cancelCalls).toHaveLength(0);
    });
  });

  describe("deleteShareRequest", () => {
    it("the requester can delete their own resolved (approved) request", async () => {
      seedPendingRequest({ status: "approved" });
      await ShareRequestService.deleteShareRequest("request-1", "owner-1");
      expect(state.deleteCalls).toEqual(["request-1"]);
    });

    it("the requester can delete their own resolved (rejected) request", async () => {
      seedPendingRequest({ status: "rejected" });
      await ShareRequestService.deleteShareRequest("request-1", "owner-1");
      expect(state.deleteCalls).toEqual(["request-1"]);
    });

    it("the requester can delete their own resolved (cancelled) request", async () => {
      seedPendingRequest({ status: "cancelled" });
      await ShareRequestService.deleteShareRequest("request-1", "owner-1");
      expect(state.deleteCalls).toEqual(["request-1"]);
    });

    it("rejects deleting a pending request (must be resolved first)", async () => {
      seedPendingRequest();
      await expect(ShareRequestService.deleteShareRequest("request-1", "owner-1")).rejects.toThrow();
      expect(state.deleteCalls).toHaveLength(0);
    });

    it("rejects a non-requester", async () => {
      seedPendingRequest({ status: "approved" });
      await expect(ShareRequestService.deleteShareRequest("request-1", "someone-else")).rejects.toThrow();
      expect(state.deleteCalls).toHaveLength(0);
    });

    it("rejects when the request does not exist", async () => {
      await expect(ShareRequestService.deleteShareRequest("nope", "owner-1")).rejects.toThrow();
    });
  });

  describe("clearResolvedShareRequests", () => {
    it("the owner clears resolved requests and gets the deleted count back", async () => {
      const result = await ShareRequestService.clearResolvedShareRequests("meeting-1", "owner-1");
      expect(result).toEqual({ deletedCount: 0 });
      expect(state.deleteResolvedCalls).toEqual(["meeting-1"]);
    });

    it("rejects a non-owner caller", async () => {
      await expect(ShareRequestService.clearResolvedShareRequests("meeting-1", "intruder-1")).rejects.toThrow();
      expect(state.deleteResolvedCalls).toHaveLength(0);
    });
  });

  describe("approveShareRequest", () => {
    const admin = { id: "admin-1", role: "admin" as const };
    const member = { id: "member-1", role: "member" as const };

    it("registered recipient + temporary: creates a grant with the mapped ttl, as the requester", async () => {
      seedPendingRequest({ accessType: "temporary", expiresInDays: 15 });

      await ShareRequestService.approveShareRequest(admin, "request-1");

      expect(state.grantCalls).toHaveLength(1);
      expect(state.grantCalls[0]).toMatchObject({
        callerId: "owner-1",
        meetingId: "meeting-1",
        granteeUserId: "grantee-1",
        ttlMinutes: 15 * 1440,
      });
      expect(state.shareCalls).toHaveLength(0);
    });

    it("registered recipient + permanent: creates a grant with noExpiry", async () => {
      seedPendingRequest({ accessType: "permanent" });

      await ShareRequestService.approveShareRequest(admin, "request-1");

      expect(state.grantCalls[0]).toMatchObject({ noExpiry: true });
    });

    it("unregistered recipient + single_use: creates a share honoring singleUse", async () => {
      seedPendingRequest({
        granteeUserId: null,
        recipientEmail: "guest@example.com",
        recipientEmailNormalized: "guest@example.com",
        accessType: "single_use",
      });

      await ShareRequestService.approveShareRequest(admin, "request-1");

      expect(state.shareCalls).toHaveLength(1);
      expect(state.shareCalls[0]?.callerId).toBe("owner-1");
      expect(state.shareCalls[0]?.input).toMatchObject({
        recipientEmail: "guest@example.com",
        singleUse: true,
      });
      expect(state.grantCalls).toHaveLength(0);
    });

    it("stamps resolved fields on approval (registered path)", async () => {
      seedPendingRequest();

      await ShareRequestService.approveShareRequest(admin, "request-1");

      expect(state.resolveCalls).toHaveLength(1);
      expect(state.resolveCalls[0]?.input).toMatchObject({
        status: "approved",
        resolvedBy: "admin-1",
        resolvedGrantId: "grant-1",
      });
      expect(state.requests["request-1"]?.status).toBe("approved");
    });

    it("stamps resolved fields on approval (unregistered path)", async () => {
      seedPendingRequest({
        granteeUserId: null,
        recipientEmail: "guest@example.com",
        recipientEmailNormalized: "guest@example.com",
        accessType: "permanent",
      });

      await ShareRequestService.approveShareRequest(admin, "request-1");

      expect(state.resolveCalls[0]?.input).toMatchObject({
        status: "approved",
        resolvedBy: "admin-1",
        resolvedShareId: "share-1",
      });
    });

    it("approves exactly as proposed — recipient and access type are not editable", async () => {
      seedPendingRequest({ accessType: "temporary", expiresInDays: 30 });

      await ShareRequestService.approveShareRequest(admin, "request-1");

      expect(state.grantCalls[0]).toMatchObject({ granteeUserId: "grantee-1", ttlMinutes: 30 * 1440 });
    });

    it("rejects a non-admin caller", async () => {
      seedPendingRequest();
      await expect(ShareRequestService.approveShareRequest(member, "request-1")).rejects.toThrow();
      expect(state.grantCalls).toHaveLength(0);
      expect(state.resolveCalls).toHaveLength(0);
    });

    it("rejects a non-pending request", async () => {
      seedPendingRequest({ status: "rejected" });
      await expect(ShareRequestService.approveShareRequest(admin, "request-1")).rejects.toThrow();
      expect(state.grantCalls).toHaveLength(0);
    });

    it("rejects an unknown request id", async () => {
      await expect(ShareRequestService.approveShareRequest(admin, "nope")).rejects.toThrow();
    });
  });

  describe("rejectShareRequest", () => {
    const admin = { id: "admin-1", role: "admin" as const };
    const member = { id: "member-1", role: "member" as const };

    it("admin rejects a pending request and creates nothing downstream", async () => {
      seedPendingRequest();

      await ShareRequestService.rejectShareRequest(admin, "request-1");

      expect(state.grantCalls).toHaveLength(0);
      expect(state.shareCalls).toHaveLength(0);
      expect(state.resolveCalls[0]?.input).toMatchObject({ status: "rejected", resolvedBy: "admin-1" });
      expect(state.requests["request-1"]?.status).toBe("rejected");
    });

    it("rejects a non-admin caller", async () => {
      seedPendingRequest();
      await expect(ShareRequestService.rejectShareRequest(member, "request-1")).rejects.toThrow();
      expect(state.resolveCalls).toHaveLength(0);
    });

    it("rejects a non-pending request", async () => {
      seedPendingRequest({ status: "cancelled" });
      await expect(ShareRequestService.rejectShareRequest(admin, "request-1")).rejects.toThrow();
      expect(state.resolveCalls).toHaveLength(0);
    });
  });

  describe("listPending / countPending / listByMeetingId", () => {
    it("listPending returns only pending requests", async () => {
      seedPendingRequest({ id: "request-1" });
      seedPendingRequest({ id: "request-2", status: "approved" });

      const pending = await ShareRequestService.listPending();
      expect(pending.map((r) => r.id)).toEqual(["request-1"]);
    });

    it("countPending matches the pending count", async () => {
      seedPendingRequest({ id: "request-1" });
      seedPendingRequest({ id: "request-2" });
      seedPendingRequest({ id: "request-3", status: "cancelled" });

      expect(await ShareRequestService.countPending()).toBe(2);
    });

    it("listByMeetingId returns all statuses for the owner", async () => {
      seedPendingRequest({ id: "request-1" });
      seedPendingRequest({ id: "request-2", status: "rejected" });

      const result = await ShareRequestService.listByMeetingId("owner-1", "meeting-1");
      expect(result).toHaveLength(2);
    });

    it("listByMeetingId rejects a non-owner caller", async () => {
      seedPendingRequest();
      await expect(ShareRequestService.listByMeetingId("intruder-1", "meeting-1")).rejects.toThrow();
    });
  });
});
