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

const mockFindByIdForUser = mock(() => Promise.resolve(null as unknown));
bunMock.module("@/repositories/WebMeetingRepository", () => ({
  WebMeetingRepository: {
    findByIdForUser: mockFindByIdForUser,
  },
}));

bunMock.module("@/repositories/MeetingShareRepository", () => ({
  MeetingShareRepository: {
    listByMeetingId: mock(() => Promise.resolve([] as unknown[])),
  },
}));

const { enqueueMeetingTool, getMeetingDetailTool } = await import(
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

describe("get_meeting_detail tool — ownership-scoped visibility (009 Phase 3)", () => {
  beforeEach(() => {
    mockGetServerSession.mockClear();
    mockFindByIdForUser.mockClear();
  });

  it("returns null when there is no authenticated session", async () => {
    mockGetServerSession.mockResolvedValueOnce(null);

    const result = await getMeetingDetailTool.execute({ meeting_id: "meeting-1" });

    expect(result).toBeNull();
    expect(mockFindByIdForUser).not.toHaveBeenCalled();
  });

  it("scopes the lookup to the current session user, not an unscoped fetch", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { id: "user-1" } });
    mockFindByIdForUser.mockResolvedValueOnce({
      id: "meeting-1",
      name: "Test meeting",
      status: "completed",
      summary: null,
      rawTranscription: null,
      errorMessage: null,
      startsAt: null,
      createdAt: new Date("2026-07-20T00:00:00Z"),
    });

    await getMeetingDetailTool.execute({ meeting_id: "meeting-1" });

    expect(mockFindByIdForUser).toHaveBeenCalledWith("user-1", "meeting-1");
  });

  it("returns null for a meeting the caller does not own and has no grant for", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { id: "user-2" } });
    mockFindByIdForUser.mockResolvedValueOnce(null);

    const result = await getMeetingDetailTool.execute({ meeting_id: "meeting-1" });

    expect(result).toBeNull();
  });
});
