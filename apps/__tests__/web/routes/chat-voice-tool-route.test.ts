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

const readOnlyExecute = mock(() => Promise.resolve([{ id: "meeting-1", name: "Kickoff" }]));
const mutatingExecute = mock(() => Promise.resolve({ success: true }));

bunMock.module("@/integrations/chat/tools", () => ({
  READ_ONLY_TOOLS: [
    {
      name: "search_meetings",
      description: "Busca reuniones",
      parameters: { type: "object", properties: {} },
      execute: readOnlyExecute,
    },
  ],
  ALL_TOOLS: [
    {
      name: "search_meetings",
      description: "Busca reuniones",
      parameters: { type: "object", properties: {} },
      execute: readOnlyExecute,
    },
    {
      name: "enqueue_meeting",
      description: "Encola una reunión",
      parameters: { type: "object", properties: {} },
      execute: mutatingExecute,
      mutates: true,
    },
  ],
  MUTATING_TOOLS: [
    {
      name: "enqueue_meeting",
      description: "Encola una reunión",
      parameters: { type: "object", properties: {} },
      execute: mutatingExecute,
      mutates: true,
    },
  ],
}));

const { POST } = await import("../../../web/src/app/api/chat/voice/tool/route");

const ORIGINAL_ENABLED = process.env.VOICE_CHAT_ENABLED;

function callToolRoute(payload: unknown): Promise<Response> {
  const req = new Request("http://localhost/api/chat/voice/tool", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
  return POST(req as never);
}

beforeEach(() => {
  mockGetServerSession.mockClear();
  readOnlyExecute.mockClear();
  mutatingExecute.mockClear();
  readOnlyExecute.mockImplementation(() =>
    Promise.resolve([{ id: "meeting-1", name: "Kickoff" }]),
  );
  process.env.VOICE_CHAT_ENABLED = "true";
});

afterEach(() => {
  if (ORIGINAL_ENABLED === undefined) delete process.env.VOICE_CHAT_ENABLED;
  else process.env.VOICE_CHAT_ENABLED = ORIGINAL_ENABLED;
});

describe("POST /api/chat/voice/tool", () => {
  it("responde 401 sin sesión autenticada", async () => {
    mockGetServerSession.mockResolvedValueOnce(null);

    const res = await callToolRoute({ name: "search_meetings", args: {} });

    expect(res.status).toBe(401);
    expect(readOnlyExecute).not.toHaveBeenCalled();
  });

  it("responde 503 con la feature apagada sin ejecutar nada", async () => {
    process.env.VOICE_CHAT_ENABLED = "false";
    mockGetServerSession.mockResolvedValueOnce({ user: { id: "user-1" } });

    const res = await callToolRoute({ name: "search_meetings", args: {} });

    expect(res.status).toBe(503);
    expect(readOnlyExecute).not.toHaveBeenCalled();
  });

  it("responde 403 para una tool mutating, sin ejecutarla", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { id: "user-1" } });

    const res = await callToolRoute({
      name: "enqueue_meeting",
      args: { meeting_url: "https://meet.google.com/abc-defg-hij" },
    });

    expect(res.status).toBe(403);
    expect(mutatingExecute).not.toHaveBeenCalled();
    expect(readOnlyExecute).not.toHaveBeenCalled();
  });

  it("responde 403 para una tool desconocida", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { id: "user-1" } });

    const res = await callToolRoute({ name: "drop_database", args: {} });

    expect(res.status).toBe(403);
    expect(readOnlyExecute).not.toHaveBeenCalled();
  });

  it("ejecuta una tool de lectura y devuelve { result }", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { id: "user-1" } });

    const res = await callToolRoute({ name: "search_meetings", args: { query: "martes" } });

    expect(res.status).toBe(200);
    expect(readOnlyExecute).toHaveBeenCalledWith({ query: "martes" });
    const body = await res.json();
    expect(body).toEqual({ result: [{ id: "meeting-1", name: "Kickoff" }] });
  });

  it("responde 500 con mensaje genérico cuando la tool falla", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { id: "user-1" } });
    readOnlyExecute.mockRejectedValueOnce(new Error("secreto interno de la base de datos"));

    const res = await callToolRoute({ name: "search_meetings", args: {} });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).not.toHaveProperty("result");
    expect(body.error).toBeTruthy();
    expect(body.error).not.toContain("secreto interno");
  });

  it("responde 400 si falta el nombre de la tool", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { id: "user-1" } });

    const res = await callToolRoute({ args: {} });

    expect(res.status).toBe(400);
    expect(readOnlyExecute).not.toHaveBeenCalled();
  });
});
