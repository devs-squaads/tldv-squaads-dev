/// <reference types="bun" />

import { describe, expect, it, mock, beforeEach } from "bun:test";

// Mock modules before importing the route
const bunMock = mock as typeof mock & {
  module: (specifier: string, factory: () => unknown) => void;
};

const mockGetServerSession = mock(() => Promise.resolve(null as { user: { id: string } } | null));

bunMock.module("next-auth", () => ({
  getServerSession: mockGetServerSession,
  authOptions: {},
}));

bunMock.module("@/auth", () => ({
  authOptions: {},
}));

// Mock requestContext
bunMock.module("@/modules/chat/http/requestContext", () => ({
  createChatRequestContext: mock((request: Pick<Request, "headers">, route: string) => {
    const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
    const responseHeaders = new Headers({ "X-Request-Id": requestId });
    return {
      requestId,
      route,
      responseHeaders,
      observability: {
        route,
        events: {},
        requestId,
      },
    };
  }),
  jsonWithChatRequestContext: mock(
    (
      context: { requestId: string; responseHeaders: Headers },
      body: unknown,
      init?: { status?: number; headers?: HeadersInit },
    ) => {
      const headers = new Headers(init?.headers);
      // Copy X-Request-Id from context responseHeaders
      const contextRequestId = context.responseHeaders.get("X-Request-Id");
      if (contextRequestId) {
        headers.set("X-Request-Id", contextRequestId);
      }
      headers.set("Content-Type", "application/json");
      return new Response(JSON.stringify(body), {
        status: init?.status,
        headers,
      });
    },
  ),
}));

// Mock ChatMessageRepository
let repositoryFindByUserIdCalls: string[] = [];
let repositoryReplaceForUserCalls: Array<{ userId: string; messages: unknown[] }> = [];
let repositoryDeleteByUserIdCalls: string[] = [];

const mockFindByUserId = mock((userId: string) => {
  repositoryFindByUserIdCalls.push(userId);
  return Promise.resolve([
    { role: "user", content: "Hello" },
    { role: "assistant", content: "Hi there" },
  ]);
});

const mockReplaceForUser = mock((userId: string, messages: unknown[]) => {
  repositoryReplaceForUserCalls.push({ userId, messages });
  return Promise.resolve();
});

const mockDeleteByUserId = mock((userId: string) => {
  repositoryDeleteByUserIdCalls.push(userId);
  return Promise.resolve();
});

bunMock.module("@/repositories/ChatMessageRepository", () => ({
  ChatMessageRepository: {
    findByUserId: mockFindByUserId,
    replaceForUser: mockReplaceForUser,
    deleteByUserId: mockDeleteByUserId,
  },
}));

// Import the route after mocking
const { GET, POST, DELETE } = await import("../../../web/src/app/api/chat/history/route");

describe("GET /api/chat/history", () => {
  beforeEach(() => {
    mockGetServerSession.mockClear();
    mockFindByUserId.mockClear();
    repositoryFindByUserIdCalls = [];
  });

  it("returns 401 when no session exists", async () => {
    mockGetServerSession.mockResolvedValueOnce(null);

    const req = new Request("http://localhost/api/chat/history", {
      method: "GET",
    });

    const res = await GET(req);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "Unauthorized" });
    expect(mockFindByUserId).not.toHaveBeenCalled();
  });

  it("returns messages with auth", async () => {
    mockGetServerSession.mockResolvedValueOnce({
      user: { id: "user-123" },
    });

    const req = new Request("http://localhost/api/chat/history", {
      method: "GET",
    });

    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(mockFindByUserId).toHaveBeenCalledWith("user-123");
    const body = await res.json();
    expect(body).toHaveProperty("messages");
    expect(Array.isArray(body.messages)).toBe(true);
  });

  it("returns X-Request-Id header in response", async () => {
    mockGetServerSession.mockResolvedValueOnce({
      user: { id: "user-123" },
    });

    const req = new Request("http://localhost/api/chat/history", {
      method: "GET",
      headers: { "x-request-id": "test-request-123" },
    });

    const res = await GET(req);

    expect(res.headers.get("X-Request-Id")).toBe("test-request-123");
  });
});

describe("POST /api/chat/history", () => {
  beforeEach(() => {
    mockGetServerSession.mockClear();
    mockReplaceForUser.mockClear();
    repositoryReplaceForUserCalls = [];
  });

  it("returns 401 when no session exists", async () => {
    mockGetServerSession.mockResolvedValueOnce(null);

    const req = new Request("http://localhost/api/chat/history", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: "test" }] }),
    });

    const res = await POST(req);

    expect(res.status).toBe(401);
    expect(mockReplaceForUser).not.toHaveBeenCalled();
  });

  it("replaces history with valid payload", async () => {
    mockGetServerSession.mockResolvedValueOnce({
      user: { id: "user-123" },
    });

    const messages = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ];

    const req = new Request("http://localhost/api/chat/history", {
      method: "POST",
      body: JSON.stringify({ messages }),
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(mockReplaceForUser).toHaveBeenCalledWith("user-123", messages);
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it("returns 400 for invalid JSON", async () => {
    mockGetServerSession.mockResolvedValueOnce({
      user: { id: "user-123" },
    });

    const req = new Request("http://localhost/api/chat/history", {
      method: "POST",
      body: "not-valid-json",
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  it("returns 400 for invalid payload structure", async () => {
    mockGetServerSession.mockResolvedValueOnce({
      user: { id: "user-123" },
    });

    const req = new Request("http://localhost/api/chat/history", {
      method: "POST",
      body: JSON.stringify({ notMessages: "invalid" }),
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it("handles empty messages array", async () => {
    mockGetServerSession.mockResolvedValueOnce({
      user: { id: "user-123" },
    });

    const req = new Request("http://localhost/api/chat/history", {
      method: "POST",
      body: JSON.stringify({ messages: [] }),
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(mockReplaceForUser).toHaveBeenCalledWith("user-123", []);
  });

  it("returns X-Request-Id header in response", async () => {
    mockGetServerSession.mockResolvedValueOnce({
      user: { id: "user-123" },
    });

    const req = new Request("http://localhost/api/chat/history", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: "test" }] }),
      headers: { "x-request-id": "test-request-456" },
    });

    const res = await POST(req);

    expect(res.headers.get("X-Request-Id")).toBe("test-request-456");
  });
});

describe("DELETE /api/chat/history", () => {
  beforeEach(() => {
    mockGetServerSession.mockClear();
    mockDeleteByUserId.mockClear();
    repositoryDeleteByUserIdCalls = [];
  });

  it("returns 401 when no session exists", async () => {
    mockGetServerSession.mockResolvedValueOnce(null);

    const req = new Request("http://localhost/api/chat/history", {
      method: "DELETE",
    });

    const res = await DELETE(req);

    expect(res.status).toBe(401);
    expect(mockDeleteByUserId).not.toHaveBeenCalled();
  });

  it("deletes history with auth", async () => {
    mockGetServerSession.mockResolvedValueOnce({
      user: { id: "user-123" },
    });

    const req = new Request("http://localhost/api/chat/history", {
      method: "DELETE",
    });

    const res = await DELETE(req);

    expect(res.status).toBe(200);
    expect(mockDeleteByUserId).toHaveBeenCalledWith("user-123");
    const body = await res.json();
    expect(body).toEqual({ ok: true });
  });

  it("returns X-Request-Id header in response", async () => {
    mockGetServerSession.mockResolvedValueOnce({
      user: { id: "user-123" },
    });

    const req = new Request("http://localhost/api/chat/history", {
      method: "DELETE",
      headers: { "x-request-id": "test-request-789" },
    });

    const res = await DELETE(req);

    expect(res.headers.get("X-Request-Id")).toBe("test-request-789");
  });
});
