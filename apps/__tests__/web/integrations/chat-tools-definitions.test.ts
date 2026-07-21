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

const { enqueueMeetingTool } = await import("../../../web/src/integrations/chat/tools/definitions");

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
