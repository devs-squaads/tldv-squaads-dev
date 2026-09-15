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

// Tools: el constructor real de restricciones consume este módulo. La ruta debe
// pasar SOLO READ_ONLY_TOOLS, nunca las mutating.
const mutatingExecute = mock(() => Promise.resolve({ success: true }));
bunMock.module("@/integrations/chat/tools", () => ({
  READ_ONLY_TOOLS: [
    {
      name: "search_meetings",
      description: "Busca reuniones",
      parameters: { type: "object", properties: {} },
      execute: async () => [],
    },
  ],
  ALL_TOOLS: [
    {
      name: "search_meetings",
      description: "Busca reuniones",
      parameters: { type: "object", properties: {} },
      execute: async () => [],
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

const mockFindByUserId = mock(() => Promise.resolve([{ role: "user", content: "hola" }]));
bunMock.module("@/repositories/ChatMessageRepository", () => ({
  ChatMessageRepository: {
    findByUserId: mockFindByUserId,
  },
}));

const mockBuildUserContext = mock(() => Promise.resolve("Contexto del usuario"));
bunMock.module("@/integrations/chat/knowledge/userContext", () => ({
  buildUserContext: mockBuildUserContext,
}));

const mockAssembleChatSystemPrompt = mock(() => ({
  systemContent: "PROMPT DE VOZ",
  snippets: [],
  mode: "documental" as const,
}));
bunMock.module("@/integrations/chat/knowledge/promptAssembler", () => ({
  assembleChatSystemPrompt: mockAssembleChatSystemPrompt,
}));

const { POST } = await import("../../../web/src/app/api/chat/voice/token/route");

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_ENABLED = process.env.VOICE_CHAT_ENABLED;
const ORIGINAL_API_KEY = process.env.GEMINI_API_KEY;
const ORIGINAL_TRANSCRIBE_MODEL = process.env.GEMINI_LIVE_TRANSCRIBE_MODEL;

interface FetchCall {
  url: string;
  init?: RequestInit;
}

interface SentAuthTokenBody {
  uses: number;
  expireTime: string;
  newSessionExpireTime: string;
  bidiGenerateContentSetup: {
    model: string;
    generationConfig: { responseModalities: string[] };
    systemInstruction?: { parts: Array<{ text: string }> };
    tools?: Array<{ functionDeclarations: Array<{ name: string; behavior: string }> }>;
    inputAudioTranscription?: { languageCodes: string[] };
  };
}

let fetchCalls: FetchCall[] = [];

function okResponse() {
  return new Response(
    JSON.stringify({
      name: "auth_tokens/tok-1",
      expireTime: "2026-09-15T12:30:00.000Z",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

const mockFetch = mock((url: string, init?: RequestInit) => {
  fetchCalls.push({ url, init });
  return Promise.resolve(okResponse());
});

function callTokenRoute(purpose?: "conversation" | "transcription" | "invalid"): Promise<Response> {
  const req = new Request("http://localhost/api/chat/voice/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(purpose === undefined ? {} : { purpose }),
  });
  return POST(req as never);
}

function lastSentBody(): SentAuthTokenBody {
  const call = fetchCalls[fetchCalls.length - 1];
  return JSON.parse(String(call?.init?.body)) as SentAuthTokenBody;
}

beforeEach(() => {
  mockGetServerSession.mockClear();
  mockFetch.mockClear();
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    fetchCalls.push({ url, init });
    return Promise.resolve(okResponse());
  });
  mockFindByUserId.mockClear();
  mockBuildUserContext.mockClear();
  mockAssembleChatSystemPrompt.mockClear();
  mutatingExecute.mockClear();
  fetchCalls = [];
  globalThis.fetch = mockFetch as unknown as typeof fetch;
  process.env.VOICE_CHAT_ENABLED = "true";
  process.env.GEMINI_API_KEY = "test-api-key";
  delete process.env.GEMINI_LIVE_TRANSCRIBE_MODEL;
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_ENABLED === undefined) delete process.env.VOICE_CHAT_ENABLED;
  else process.env.VOICE_CHAT_ENABLED = ORIGINAL_ENABLED;
  if (ORIGINAL_API_KEY === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = ORIGINAL_API_KEY;
  if (ORIGINAL_TRANSCRIBE_MODEL === undefined) delete process.env.GEMINI_LIVE_TRANSCRIBE_MODEL;
  else process.env.GEMINI_LIVE_TRANSCRIBE_MODEL = ORIGINAL_TRANSCRIBE_MODEL;
});

describe("POST /api/chat/voice/token · autenticación y gate", () => {
  it("responde 401 sin sesión autenticada y no llama a Google", async () => {
    mockGetServerSession.mockResolvedValueOnce(null);

    const res = await callTokenRoute();

    expect(res.status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("responde 503 con la feature apagada, sin llamar a Google", async () => {
    process.env.VOICE_CHAT_ENABLED = "false";
    mockGetServerSession.mockResolvedValueOnce({ user: { id: "user-disabled" } });

    const res = await callTokenRoute();

    expect(res.status).toBe(503);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("responde 503 si falta GEMINI_API_KEY, sin llamar a Google", async () => {
    delete process.env.GEMINI_API_KEY;
    mockGetServerSession.mockResolvedValueOnce({ user: { id: "user-no-key" } });

    const res = await callTokenRoute();

    expect(res.status).toBe(503);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("responde 400 ante un purpose desconocido", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { id: "user-bad-purpose" } });

    const res = await callTokenRoute("invalid");

    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("POST /api/chat/voice/token · conversación", () => {
  it("mintea el token con uses:1 y la forma verificada, solo con tools de lectura", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { id: "user-happy" } });

    const res = await callTokenRoute();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.token).toBe("auth_tokens/tok-1");
    expect(body.model).toBe("gemini-3.8-live");
    expect(body.expiresAt).toBe("2026-09-15T12:30:00.000Z");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const call = fetchCalls[0];
    expect(call?.url).toBe("https://generativelanguage.googleapis.com/v1beta/auth_tokens");
    expect(call?.init?.method).toBe("POST");

    const headers = new Headers(call?.init?.headers);
    expect(headers.get("x-goog-api-key")).toBe("test-api-key");
    expect(headers.get("Content-Type")).toBe("application/json");

    const sent = lastSentBody();
    expect(sent.uses).toBe(1);
    expect(sent).not.toHaveProperty("liveConnectConstraints");
    expect(sent.bidiGenerateContentSetup.model).toBe("models/gemini-3.8-live");
    expect(sent.bidiGenerateContentSetup.generationConfig.responseModalities).toEqual(["AUDIO"]);
    expect(sent.bidiGenerateContentSetup.systemInstruction?.parts[0]?.text).toBe("PROMPT DE VOZ");
    expect(sent.bidiGenerateContentSetup).not.toHaveProperty("sessionResumption");
    expect(sent.bidiGenerateContentSetup).not.toHaveProperty("contextWindowCompression");
    expect(sent.bidiGenerateContentSetup).not.toHaveProperty("inputAudioTranscription");
    expect(sent.bidiGenerateContentSetup).not.toHaveProperty("outputAudioTranscription");

    const declarationNames = sent.bidiGenerateContentSetup.tools?.[0]?.functionDeclarations.map(
      (declaration) => declaration.name,
    );
    expect(declarationNames).toEqual(["search_meetings"]);
    expect(declarationNames).not.toContain("enqueue_meeting");
    expect(sent.bidiGenerateContentSetup.tools?.[0]?.functionDeclarations[0]?.behavior).toBe(
      "BLOCKING",
    );
  });

  it("arma el prompt con el contexto del usuario y el canal de voz", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { id: "user-prompt", role: "admin" } });

    await callTokenRoute();

    expect(mockBuildUserContext).toHaveBeenCalledWith({ userId: "user-prompt", role: "admin" });
    expect(mockAssembleChatSystemPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ userContext: "Contexto del usuario", channel: "voice" }),
    );
  });

  it("responde 502 cuando Google devuelve un error", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { id: "user-google-error" } });
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve(new Response(JSON.stringify({ error: "boom" }), { status: 400 })),
    );

    const res = await callTokenRoute();

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it("responde 502 cuando la respuesta de Google no trae name", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { id: "user-no-name" } });
    mockFetch.mockImplementationOnce(() =>
      Promise.resolve(new Response(JSON.stringify({}), { status: 200 })),
    );

    const res = await callTokenRoute();

    expect(res.status).toBe(502);
  });
});

describe("POST /api/chat/voice/token · transcripción", () => {
  it("mintea el modelo de transcripción con TEXT, sin tools ni systemInstruction", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { id: "user-stt" } });

    const res = await callTokenRoute("transcription");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.model).toBe("gemini-3.5-transcribe-live");

    const sent = lastSentBody();
    expect(sent.uses).toBe(1);
    expect(sent.bidiGenerateContentSetup.model).toBe("models/gemini-3.5-transcribe-live");
    expect(sent.bidiGenerateContentSetup.generationConfig.responseModalities).toEqual(["TEXT"]);
    expect(sent.bidiGenerateContentSetup.inputAudioTranscription).toEqual({ languageCodes: [] });
    expect(sent.bidiGenerateContentSetup.systemInstruction).toBeUndefined();
    expect(sent.bidiGenerateContentSetup.tools).toBeUndefined();
    expect(sent.bidiGenerateContentSetup).not.toHaveProperty("sessionResumption");
    expect(sent.bidiGenerateContentSetup).not.toHaveProperty("contextWindowCompression");
  });

  it("no toca la base ni el prompt (no necesita systemInstruction)", async () => {
    mockGetServerSession.mockResolvedValueOnce({ user: { id: "user-stt-cheap" } });

    await callTokenRoute("transcription");

    expect(mockFindByUserId).not.toHaveBeenCalled();
    expect(mockBuildUserContext).not.toHaveBeenCalled();
    expect(mockAssembleChatSystemPrompt).not.toHaveBeenCalled();
  });

  it("respeta GEMINI_LIVE_TRANSCRIBE_MODEL", async () => {
    process.env.GEMINI_LIVE_TRANSCRIBE_MODEL = "gemini-4.0-transcribe-live";
    mockGetServerSession.mockResolvedValueOnce({ user: { id: "user-stt-model" } });

    const res = await callTokenRoute("transcription");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.model).toBe("gemini-4.0-transcribe-live");
    expect(lastSentBody().bidiGenerateContentSetup.model).toBe(
      "models/gemini-4.0-transcribe-live",
    );
  });
});

describe("POST /api/chat/voice/token · rate limit", () => {
  it("consume el cupo solo con el token de conversación: el de transcripción sigue funcionando", async () => {
    const userId = "user-rate-limited";

    let lastConversationStatus = 0;
    for (let attempt = 0; attempt < 11; attempt += 1) {
      mockGetServerSession.mockResolvedValueOnce({ user: { id: userId } });
      const res = await callTokenRoute("conversation");
      lastConversationStatus = res.status;
    }

    expect(lastConversationStatus).toBe(429);
    // Una llamada por cada token de conversación aceptado; la 11ª no llamó a Google.
    expect(mockFetch).toHaveBeenCalledTimes(10);

    mockGetServerSession.mockResolvedValueOnce({ user: { id: userId } });
    const transcriptionRes = await callTokenRoute("transcription");

    expect(transcriptionRes.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(11);
  });
});
