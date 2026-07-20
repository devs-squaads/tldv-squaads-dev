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

const mockInsert = mock(() => Promise.resolve());
bunMock.module("@meeting-bot/shared/repositories/MeetingRepository", () => ({
  MeetingRepository: {
    insert: mockInsert,
    findById: mock(() => Promise.resolve(null)),
  },
}));

const mockListByMeetingId = mock(() => Promise.resolve([] as unknown[]));
bunMock.module("@/repositories/MeetingShareRepository", () => ({
  MeetingShareRepository: {
    listByMeetingId: mockListByMeetingId,
    findById: mock(() => Promise.resolve(null)),
  },
}));

const mockCreateShare = mock(() =>
  Promise.resolve({
    id: "share-1",
    shareType: "restricted_email" as const,
    recipientEmail: "guest@example.com",
    expiresAt: null as Date | null,
    shareUrl: "https://app.test/share/abc",
  }),
);
const mockRevokeShare = mock(() => Promise.resolve());
bunMock.module("@/services/meetingShareService", () => ({
  MeetingShareService: {
    createShare: mockCreateShare,
    revokeShare: mockRevokeShare,
    getTtlOptionsMinutes: mock(() => [60]),
  },
}));

const { enqueueMeetingTool, manageMeetingShareTool } = await import(
  "../../../web/src/integrations/chat/tools/definitions"
);

describe("enqueue_meeting tool — owner capture (009 Phase 2)", () => {
  beforeEach(() => {
    mockGetServerSession.mockClear();
    mockInsert.mockClear();
  });

  it("rejects when there is no authenticated session", async () => {
    mockGetServerSession.mockResolvedValueOnce(null);

    const result = await enqueueMeetingTool.execute({ meeting_url: "https://meet.google.com/abc-defg-hij" });

    expect(result.success).toBe(false);
    expect(result.status).toBe("error");
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("sets ownerId from the resolved session when enqueueing", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { id: "user-1" } });

    const result = await enqueueMeetingTool.execute({ meeting_url: "https://meet.google.com/abc-defg-hij" });

    expect(result.success).toBe(true);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: "user-1" }),
    );
  });
});

describe("manage_meeting_share tool — owner-only create/revoke routed through MeetingShareService (009 Phase 6)", () => {
  beforeEach(() => {
    mockGetServerSession.mockClear();
    mockCreateShare.mockClear();
    mockRevokeShare.mockClear();
    mockListByMeetingId.mockClear();
  });

  describe("create", () => {
    it("rejects when there is no authenticated session, without calling the service", async () => {
      mockGetServerSession.mockResolvedValueOnce(null);

      const result = await manageMeetingShareTool.execute({
        action: "create",
        meeting_id: "meeting-1",
        share_type: "restricted_email",
        recipient_email: "guest@example.com",
      });

      expect(result.success).toBe(false);
      expect(mockCreateShare).not.toHaveBeenCalled();
    });

    it("routes through MeetingShareService.createShare with the resolved callerId", async () => {
      mockGetServerSession.mockResolvedValueOnce({ user: { id: "owner-1" } });

      const result = await manageMeetingShareTool.execute({
        action: "create",
        meeting_id: "meeting-1",
        share_type: "restricted_email",
        recipient_email: "guest@example.com",
      });

      expect(result.success).toBe(true);
      expect(mockCreateShare).toHaveBeenCalledWith(
        expect.objectContaining({ meetingId: "meeting-1", shareType: "restricted_email" }),
        "owner-1",
      );
      expect(result.createdShare?.shareUrl).toBe("https://app.test/share/abc");
    });

    it("surfaces MeetingShareService rejections (e.g. non-owner caller) as a structured failure instead of throwing", async () => {
      mockGetServerSession.mockResolvedValueOnce({ user: { id: "intruder-1" } });
      mockCreateShare.mockRejectedValueOnce(new Error("Only the meeting owner can share this meeting"));

      const result = await manageMeetingShareTool.execute({
        action: "create",
        meeting_id: "meeting-1",
        share_type: "restricted_email",
        recipient_email: "guest@example.com",
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("owner");
    });
  });

  describe("revoke", () => {
    it("rejects when there is no authenticated session, without calling the service", async () => {
      mockGetServerSession.mockResolvedValueOnce(null);

      const result = await manageMeetingShareTool.execute({ action: "revoke", share_id: "share-1" });

      expect(result.success).toBe(false);
      expect(mockRevokeShare).not.toHaveBeenCalled();
    });

    it("routes through MeetingShareService.revokeShare with the resolved callerId", async () => {
      mockGetServerSession.mockResolvedValueOnce({ user: { id: "owner-1" } });

      const result = await manageMeetingShareTool.execute({ action: "revoke", share_id: "share-1" });

      expect(result.success).toBe(true);
      expect(mockRevokeShare).toHaveBeenCalledWith("share-1", "owner-1");
    });

    it("surfaces MeetingShareService rejections as a structured failure instead of throwing", async () => {
      mockGetServerSession.mockResolvedValueOnce({ user: { id: "intruder-1" } });
      mockRevokeShare.mockRejectedValueOnce(new Error("Only the meeting owner can revoke this share"));

      const result = await manageMeetingShareTool.execute({ action: "revoke", share_id: "share-1" });

      expect(result.success).toBe(false);
    });
  });
});
