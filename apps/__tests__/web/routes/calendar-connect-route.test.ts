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

const { GET } = await import("../../../web/src/app/api/settings/calendar-connect/route");

describe("GET /api/settings/calendar-connect", () => {
  const originalNextAuthUrl = process.env.NEXTAUTH_URL;

  beforeEach(() => {
    mockGetServerSession.mockClear();
    process.env.GOOGLE_CLIENT_ID = "test-client-id";
  });

  afterEach(() => {
    if (originalNextAuthUrl === undefined) {
      delete process.env.NEXTAUTH_URL;
    } else {
      process.env.NEXTAUTH_URL = originalNextAuthUrl;
    }
  });

  it("returns 401 when there is no session", async () => {
    mockGetServerSession.mockResolvedValueOnce(null);

    const req = new Request("http://localhost/api/settings/calendar-connect");
    const res = await GET(req);

    expect(res.status).toBe(401);
  });

  it("redirects to Google requesting calendar.readonly with offline access and consent prompt", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { email: "user@squaads.com" } });

    const req = new Request("http://localhost/api/settings/calendar-connect");
    const res = await GET(req);

    expect(res.status).toBe(307);
    const location = res.headers.get("Location") || "";
    expect(location).toContain("accounts.google.com");
    const url = new URL(location);
    expect(url.searchParams.get("scope")).toContain("calendar.readonly");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost/api/settings/calendar-connect/callback",
    );
  });

  it("sets a state cookie and includes the same value as the state param, to protect the callback from CSRF", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { email: "user@squaads.com" } });

    const req = new Request("http://localhost/api/settings/calendar-connect");
    const res = await GET(req);

    const location = res.headers.get("Location") || "";
    const state = new URL(location).searchParams.get("state");
    expect(state).toBeTruthy();

    const setCookie = res.headers.get("set-cookie") || "";
    expect(setCookie).toContain(`calendar_oauth_state=${state}`);
    expect(setCookie.toLowerCase()).toContain("httponly");
  });

  it("uses NEXTAUTH_URL as the redirect_uri base when set, not the request origin", async () => {
    // Same convention NextAuth's own (already-registered-with-Google) login
    // callback uses — avoids sending Google a different redirect_uri per
    // host (localhost/preview/custom domain) that was never allow-listed.
    process.env.NEXTAUTH_URL = "https://app.squaads.com";
    mockGetServerSession.mockResolvedValueOnce({ user: { email: "user@squaads.com" } });

    const req = new Request("http://localhost/api/settings/calendar-connect");
    const res = await GET(req);

    const location = res.headers.get("Location") || "";
    const redirectUri = new URL(location).searchParams.get("redirect_uri");
    expect(redirectUri).toBe("https://app.squaads.com/api/settings/calendar-connect/callback");
  });
});
