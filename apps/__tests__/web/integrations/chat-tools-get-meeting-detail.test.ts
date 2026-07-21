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

const mockFindByIdForUser = mock(() => Promise.resolve(null as unknown));
bunMock.module("@/repositories/WebMeetingRepository", () => ({
  WebMeetingRepository: {
    findByIdForUser: mockFindByIdForUser,
  },
}));

const mockListByMeetingId = mock(() => Promise.resolve([] as unknown[]));
bunMock.module("@/repositories/MeetingShareRepository", () => ({
  MeetingShareRepository: {
    listByMeetingId: mockListByMeetingId,
  },
}));

bunMock.module("@meeting-bot/shared/repositories/MeetingRepository", () => ({
  MeetingRepository: {
    findById: mock(() => Promise.resolve(null)),
  },
}));

const { getMeetingDetailTool } = await import("../../../web/src/integrations/chat/tools/definitions");

describe("get_meeting_detail tool — ownership-scoped visibility (009 Phase 3)", () => {
  beforeEach(() => {
    mockGetServerSession.mockClear();
    mockFindByIdForUser.mockClear();
    mockListByMeetingId.mockClear();
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
