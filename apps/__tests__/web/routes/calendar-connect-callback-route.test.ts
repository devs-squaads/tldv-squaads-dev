/// <reference types="bun" />

import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";

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

const mockFindByEmail = mock(() => Promise.resolve(null as unknown));
const mockUpdateTokens = mock(() => Promise.resolve());
const mockSetCalendarEnabled = mock(() => Promise.resolve());
bunMock.module("@meeting-bot/shared/repositories/CalendarAccountRepository", () => ({
  CalendarAccountRepository: {
    findByEmail: mockFindByEmail,
    updateTokens: mockUpdateTokens,
    setCalendarEnabled: mockSetCalendarEnabled,
  },
}));

const { GET } = await import(
  "../../../web/src/app/api/settings/calendar-connect/callback/route"
);

const originalFetch = globalThis.fetch;

describe("GET /api/settings/calendar-connect/callback", () => {
  const originalNextAuthUrl = process.env.NEXTAUTH_URL;

  beforeEach(() => {
    mockGetServerSession.mockClear();
    mockFindByEmail.mockClear();
    mockUpdateTokens.mockClear();
    mockSetCalendarEnabled.mockClear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalNextAuthUrl === undefined) {
      delete process.env.NEXTAUTH_URL;
    } else {
      process.env.NEXTAUTH_URL = originalNextAuthUrl;
    }
  });

  it("returns 401 when there is no session", async () => {
    mockGetServerSession.mockResolvedValueOnce(null);

    const req = new Request("http://localhost/api/settings/calendar-connect/callback?code=abc");
    const res = await GET(req);

    expect(res.status).toBe(401);
  });

  it("exchanges the code, persists tokens, and enables the calendar", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { email: "user@squaads.com" } });
    mockFindByEmail.mockResolvedValueOnce({ id: "user-1", email: "user@squaads.com" });

    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: "new-access-token",
            refresh_token: "new-refresh-token",
            expires_in: 3600,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    ) as typeof fetch;

    const req = new Request(
      "http://localhost/api/settings/calendar-connect/callback?code=abc123&state=match-state",
      { headers: { cookie: "calendar_oauth_state=match-state" } },
    );
    const res = await GET(req);

    expect(res.status).toBe(307);
    expect(mockUpdateTokens).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ accessToken: "new-access-token", refreshToken: "new-refresh-token" }),
    );
    expect(mockSetCalendarEnabled).toHaveBeenCalledWith("user-1", true);
  });

  it("redirects with an error and skips persistence when Google returns no code", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { email: "user@squaads.com" } });

    const req = new Request("http://localhost/api/settings/calendar-connect/callback");
    const res = await GET(req);

    expect(res.status).toBe(307);
    expect(res.headers.get("Location")).toContain("calendar=error");
    expect(mockUpdateTokens).not.toHaveBeenCalled();
    expect(mockSetCalendarEnabled).not.toHaveBeenCalled();
  });

  it("rejects the callback when the state param does not match the cookie (CSRF guard)", async () => {
    // Otherwise-valid conditions (session, code, token exchange, known user) so
    // the ONLY reason this can fail is the state check — if the guard were
    // missing, this would incorrectly succeed like the "accepts" test below.
    mockGetServerSession.mockResolvedValueOnce({ user: { email: "user@squaads.com" } });
    mockFindByEmail.mockResolvedValueOnce({ id: "user-1", email: "user@squaads.com" });
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ access_token: "tok", refresh_token: "rt", expires_in: 3600 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    ) as typeof fetch;

    const req = new Request(
      "http://localhost/api/settings/calendar-connect/callback?code=abc123&state=attacker-state",
      { headers: { cookie: "calendar_oauth_state=real-state" } },
    );
    const res = await GET(req);

    expect(res.status).toBe(307);
    expect(res.headers.get("Location")).toContain("calendar=error");
    expect(mockUpdateTokens).not.toHaveBeenCalled();
    expect(mockSetCalendarEnabled).not.toHaveBeenCalled();
  });

  it("accepts the callback when the state param matches the cookie", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { email: "user@squaads.com" } });
    mockFindByEmail.mockResolvedValueOnce({ id: "user-1", email: "user@squaads.com" });

    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ access_token: "tok", refresh_token: "rt", expires_in: 3600 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    ) as typeof fetch;

    const req = new Request(
      "http://localhost/api/settings/calendar-connect/callback?code=abc123&state=match-state",
      { headers: { cookie: "calendar_oauth_state=match-state" } },
    );
    const res = await GET(req);

    expect(res.status).toBe(307);
    expect(res.headers.get("Location")).toContain("calendar=connected");
    expect(mockUpdateTokens).toHaveBeenCalled();
  });

  it("sends NEXTAUTH_URL as the redirect_uri in the token exchange when set, matching the authorize request", async () => {
    process.env.NEXTAUTH_URL = "https://app.squaads.com";
    mockGetServerSession.mockResolvedValueOnce({ user: { email: "user@squaads.com" } });
    mockFindByEmail.mockResolvedValueOnce({ id: "user-1", email: "user@squaads.com" });

    let sentBody: URLSearchParams | undefined;
    globalThis.fetch = mock((_url: unknown, init?: RequestInit) => {
      sentBody = init?.body as URLSearchParams;
      return Promise.resolve(
        new Response(
          JSON.stringify({ access_token: "tok", refresh_token: "rt", expires_in: 3600 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }) as typeof fetch;

    const req = new Request(
      "http://localhost/api/settings/calendar-connect/callback?code=abc123&state=match-state",
      { headers: { cookie: "calendar_oauth_state=match-state" } },
    );
    await GET(req);

    expect(sentBody?.get("redirect_uri")).toBe(
      "https://app.squaads.com/api/settings/calendar-connect/callback",
    );
  });
});
