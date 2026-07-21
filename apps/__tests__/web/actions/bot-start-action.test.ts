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

const mockEnqueueMeeting = mock(() => Promise.resolve({ id: "meeting-1" }));
bunMock.module("@/services/meetingService", () => ({
  MeetingService: {
    enqueueMeeting: mockEnqueueMeeting,
    deleteMeeting: mock(() => Promise.resolve({ success: true })),
  },
}));

bunMock.module("@/services/workerRecoveryClient", () => ({
  requestMeetingReprocess: mock(() => Promise.resolve({ success: true })),
  requestMeetingRetry: mock(() => Promise.resolve({ success: true })),
  requestMeetingSummaryRefine: mock(() => Promise.resolve({ success: true })),
}));

const { startBotAction } = await import("../../../web/src/app/actions/bot");

describe("startBotAction — owner capture (009 Phase 2)", () => {
  beforeEach(() => {
    mockGetServerSession.mockClear();
    mockEnqueueMeeting.mockClear();
  });

  it("rejects when there is no authenticated session", async () => {
    mockGetServerSession.mockResolvedValueOnce(null);

    const result = await startBotAction({
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      botName: "Bot",
      duration: 60,
    });

    expect(result.success).toBe(false);
    expect(mockEnqueueMeeting).not.toHaveBeenCalled();
  });

  it("threads session.user.id as ownerId when enqueueing", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { id: "user-1" } });

    const result = await startBotAction({
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      botName: "Bot",
      duration: 60,
    });

    expect(result.success).toBe(true);
    expect(mockEnqueueMeeting).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: "user-1" }),
    );
  });
});
