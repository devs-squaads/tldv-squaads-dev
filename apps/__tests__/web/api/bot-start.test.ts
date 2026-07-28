/// <reference types="bun" />

import { describe, expect, it, mock, beforeEach } from "bun:test";

const bunMock = mock as typeof mock & {
  module: (specifier: string, factory: () => unknown) => void;
};

const mockEnqueueMeeting = mock(() => Promise.resolve({ id: "meeting-1" }));
bunMock.module("@/services/meetingService", () => ({
  MeetingService: { enqueueMeeting: mockEnqueueMeeting },
}));

const mockFindByEmail = mock(() => Promise.resolve(null as { id: string; email: string } | null));
bunMock.module("@meeting-bot/shared/repositories/UserRepository", () => ({
  // findByIds stubbed to keep this process-wide mock.module() registration
  // (first-registration-wins) satisfying the real UserRepository interface for any other test
  // file that transitively depends on it.
  UserRepository: { findByEmail: mockFindByEmail, findByIds: async () => [] },
}));

const { POST } = await import("../../../web/src/app/api/bot/start/route");

describe("POST /api/bot/start — legacy machine-to-machine ownerEmail resolution (009 Phase 2)", () => {
  beforeEach(() => {
    mockEnqueueMeeting.mockClear();
    mockFindByEmail.mockClear();
    delete process.env.API_ROUTE_SECRET;
  });

  it("returns 400 when ownerEmail is missing from the body", async () => {
    const req = new Request("http://localhost/api/bot/start", {
      method: "POST",
      body: JSON.stringify({ meetingUrl: "https://meet.google.com/abc-defg-hij" }),
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("ownerEmail");
    expect(mockFindByEmail).not.toHaveBeenCalled();
    expect(mockEnqueueMeeting).not.toHaveBeenCalled();
  });

  it("returns 400 when ownerEmail does not match a registered user", async () => {
    mockFindByEmail.mockResolvedValueOnce(null);

    const req = new Request("http://localhost/api/bot/start", {
      method: "POST",
      body: JSON.stringify({
        meetingUrl: "https://meet.google.com/abc-defg-hij",
        ownerEmail: "nobody@squaads.com",
      }),
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("ownerEmail");
    expect(mockEnqueueMeeting).not.toHaveBeenCalled();
  });

  it("enqueues with the resolved ownerId when ownerEmail matches a registered user", async () => {
    mockFindByEmail.mockResolvedValueOnce({ id: "user-1", email: "owner@squaads.com" });

    const req = new Request("http://localhost/api/bot/start", {
      method: "POST",
      body: JSON.stringify({
        meetingUrl: "https://meet.google.com/abc-defg-hij",
        ownerEmail: "owner@squaads.com",
      }),
    });

    const res = await POST(req);

    expect(res.status).toBe(202);
    expect(mockFindByEmail).toHaveBeenCalledWith("owner@squaads.com");
    expect(mockEnqueueMeeting).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: "user-1" }),
    );
  });
});
