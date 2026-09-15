/// <reference types="bun" />

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

const bunMock = mock as typeof mock & {
  module: (specifier: string, factory: () => unknown) => void;
};

const mockGetServerSession = mock(() => Promise.resolve(null as { user: { id: string } } | null));

bunMock.module("next-auth", () => ({
  getServerSession: mockGetServerSession,
}));

bunMock.module("@/auth", () => ({
  authOptions: {},
}));

const { GET } = await import("../../../web/src/app/api/chat/voice/config/route");

const ORIGINAL_ENABLED = process.env.VOICE_CHAT_ENABLED;
const ORIGINAL_MODEL = process.env.GEMINI_LIVE_MODEL;
const ORIGINAL_MAX = process.env.VOICE_CHAT_MAX_SESSION_MINUTES;

beforeEach(() => {
  mockGetServerSession.mockClear();
  delete process.env.VOICE_CHAT_ENABLED;
  delete process.env.GEMINI_LIVE_MODEL;
  delete process.env.VOICE_CHAT_MAX_SESSION_MINUTES;
});

afterEach(() => {
  if (ORIGINAL_ENABLED === undefined) delete process.env.VOICE_CHAT_ENABLED;
  else process.env.VOICE_CHAT_ENABLED = ORIGINAL_ENABLED;
  if (ORIGINAL_MODEL === undefined) delete process.env.GEMINI_LIVE_MODEL;
  else process.env.GEMINI_LIVE_MODEL = ORIGINAL_MODEL;
  if (ORIGINAL_MAX === undefined) delete process.env.VOICE_CHAT_MAX_SESSION_MINUTES;
  else process.env.VOICE_CHAT_MAX_SESSION_MINUTES = ORIGINAL_MAX;
});

describe("GET /api/chat/voice/config", () => {
  it("responde 401 sin sesión autenticada", async () => {
    mockGetServerSession.mockResolvedValueOnce(null);

    const res = await GET();

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: "Unauthorized" });
  });

  it("responde enabled:false con el flag apagado (default)", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { id: "user-1" } });

    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enabled).toBe(false);
    expect(body.model).toBe("gemini-3.8-live");
    expect(body.maxSessionMinutes).toBe(15);
  });

  it("expone modelo y tope configurados cuando está encendida", async () => {
    process.env.VOICE_CHAT_ENABLED = "true";
    process.env.GEMINI_LIVE_MODEL = "gemini-4.0-live";
    process.env.VOICE_CHAT_MAX_SESSION_MINUTES = "30";
    mockGetServerSession.mockResolvedValueOnce({ user: { id: "user-1" } });

    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      enabled: true,
      model: "gemini-4.0-live",
      maxSessionMinutes: 30,
    });
  });
});
