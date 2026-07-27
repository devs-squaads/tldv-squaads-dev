/// <reference types="bun" />

import { describe, expect, it, mock, beforeEach } from "bun:test";

const bunMock = mock as typeof mock & {
  module: (specifier: string, factory: () => unknown) => void;
};

const mockGetServerSession = mock(() => Promise.resolve(null as unknown));
bunMock.module("next-auth", () => ({
  getServerSession: mockGetServerSession,
}));
bunMock.module("@/auth", () => ({
  authOptions: {},
}));

const mockCreateShareRequest = mock((input: unknown) => Promise.resolve({ id: "request-1", ...(input as object) }));
const mockCancelShareRequest = mock(() => Promise.resolve());
const mockApproveShareRequest = mock(() => Promise.resolve());
const mockRejectShareRequest = mock(() => Promise.resolve());
const mockListByMeetingId = mock(() => Promise.resolve([{ id: "request-1" }]));
const mockListPending = mock(() => Promise.resolve([{ id: "request-1" }]));

bunMock.module("@/services/shareRequestService", () => ({
  ShareRequestService: {
    createShareRequest: mockCreateShareRequest,
    cancelShareRequest: mockCancelShareRequest,
    approveShareRequest: mockApproveShareRequest,
    rejectShareRequest: mockRejectShareRequest,
    listByMeetingId: mockListByMeetingId,
    listPending: mockListPending,
  },
}));

const {
  createShareRequestAction,
  cancelShareRequestAction,
  approveShareRequestAction,
  rejectShareRequestAction,
  listShareRequestsByMeetingIdAction,
  listPendingShareRequestsAction,
} = await import("../../../../apps/web/src/app/actions/shareRequests");

describe("shareRequests actions (013/Phase 4.5)", () => {
  beforeEach(() => {
    mockGetServerSession.mockClear();
    mockCreateShareRequest.mockClear();
    mockCancelShareRequest.mockClear();
    mockApproveShareRequest.mockClear();
    mockRejectShareRequest.mockClear();
    mockListByMeetingId.mockClear();
    mockListPending.mockClear();
  });

  describe("createShareRequestAction", () => {
    it("rejects when there is no authenticated session", async () => {
      mockGetServerSession.mockResolvedValueOnce(null);

      const result = await createShareRequestAction({
        meetingId: "meeting-1",
        recipient: { granteeUserId: "grantee-1" },
        accessType: "permanent",
      });

      expect(result.success).toBe(false);
      expect(mockCreateShareRequest).not.toHaveBeenCalled();
    });

    it("threads the session caller id as callerId", async () => {
      mockGetServerSession.mockResolvedValueOnce({ user: { id: "owner-1", role: "member" } });

      const result = await createShareRequestAction({
        meetingId: "meeting-1",
        recipient: { granteeUserId: "grantee-1" },
        accessType: "permanent",
      });

      expect(result.success).toBe(true);
      expect(mockCreateShareRequest).toHaveBeenCalledWith(
        expect.objectContaining({ callerId: "owner-1", meetingId: "meeting-1" })
      );
    });
  });

  describe("cancelShareRequestAction", () => {
    it("threads the session caller id and request id", async () => {
      mockGetServerSession.mockResolvedValueOnce({ user: { id: "owner-1", role: "member" } });

      const result = await cancelShareRequestAction("request-1");

      expect(result.success).toBe(true);
      expect(mockCancelShareRequest).toHaveBeenCalledWith("owner-1", "request-1");
    });
  });

  describe("approveShareRequestAction", () => {
    it("passes the full session caller {id, role} to the service", async () => {
      mockGetServerSession.mockResolvedValueOnce({ user: { id: "admin-1", role: "admin" } });

      const result = await approveShareRequestAction("request-1");

      expect(result.success).toBe(true);
      expect(mockApproveShareRequest).toHaveBeenCalledWith({ id: "admin-1", role: "admin" }, "request-1");
    });

    it("surfaces the service's own admin-gate rejection for a member caller", async () => {
      mockGetServerSession.mockResolvedValueOnce({ user: { id: "member-1", role: "member" } });
      mockApproveShareRequest.mockRejectedValueOnce(new Error("Only an admin can approve a share request"));

      const result = await approveShareRequestAction("request-1");

      expect(result.success).toBe(false);
    });
  });

  describe("rejectShareRequestAction", () => {
    it("passes the full session caller {id, role} to the service", async () => {
      mockGetServerSession.mockResolvedValueOnce({ user: { id: "admin-1", role: "admin" } });

      const result = await rejectShareRequestAction("request-1");

      expect(result.success).toBe(true);
      expect(mockRejectShareRequest).toHaveBeenCalledWith({ id: "admin-1", role: "admin" }, "request-1");
    });
  });

  describe("listShareRequestsByMeetingIdAction", () => {
    it("threads the session caller id and meeting id", async () => {
      mockGetServerSession.mockResolvedValueOnce({ user: { id: "owner-1", role: "member" } });

      const result = await listShareRequestsByMeetingIdAction("meeting-1");

      expect(result.success).toBe(true);
      expect(mockListByMeetingId).toHaveBeenCalledWith("owner-1", "meeting-1");
    });
  });

  describe("listPendingShareRequestsAction", () => {
    it("admin caller succeeds", async () => {
      mockGetServerSession.mockResolvedValueOnce({ user: { id: "admin-1", role: "admin" } });

      const result = await listPendingShareRequestsAction();

      expect(result.success).toBe(true);
      expect(mockListPending).toHaveBeenCalled();
    });

    it("member caller is rejected without reaching the service", async () => {
      mockGetServerSession.mockResolvedValueOnce({ user: { id: "member-1", role: "member" } });

      const result = await listPendingShareRequestsAction();

      expect(result.success).toBe(false);
      expect(mockListPending).not.toHaveBeenCalled();
    });
  });
});
