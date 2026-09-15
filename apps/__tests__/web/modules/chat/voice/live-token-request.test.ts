/// <reference types="bun" />

import { describe, expect, it } from "bun:test";

import {
  buildAuthTokenRequestBody,
  buildLiveConnectConstraints,
  parseAuthTokenResponse,
} from "../../../../../web/src/modules/chat/voice/liveTokenRequest";
import type { ToolDefinition } from "../../../../../web/src/integrations/chat/tools/types";

const READ_ONLY_SAMPLE: ToolDefinition[] = [
  {
    name: "search_meetings",
    description: "Busca reuniones",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["completed", "error"], description: "Estado" },
        limit: { type: "number", description: "Máximo" },
        nested: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
        empty: { type: "object", properties: {} },
      },
      required: ["status"],
    },
    execute: async () => [],
  },
];

function conversationSetup(model = "gemini-3.8-live") {
  return buildLiveConnectConstraints({
    purpose: "conversation",
    model,
    systemInstruction: "Sos el asistente de Squaads.",
    tools: READ_ONLY_SAMPLE,
  });
}

describe("buildLiveConnectConstraints · conversación", () => {
  it("arma el campo verificado bidiGenerateContentSetup con AUDIO, instrucción y tools", () => {
    const setup = conversationSetup();

    expect(setup.model).toBe("models/gemini-3.8-live");
    expect(setup.generationConfig).toEqual({ responseModalities: ["AUDIO"] });
    expect(setup.systemInstruction).toEqual({
      parts: [{ text: "Sos el asistente de Squaads." }],
    });
    expect(setup.tools).toHaveLength(1);
    expect(setup.tools?.[0]?.functionDeclarations[0]?.name).toBe("search_meetings");
  });

  it("es el default cuando no se pasa purpose", () => {
    const setup = buildLiveConnectConstraints({
      model: "gemini-3.8-live",
      systemInstruction: "prompt",
      tools: READ_ONLY_SAMPLE,
    });

    expect(setup.generationConfig.responseModalities).toEqual(["AUDIO"]);
    expect(setup.tools).toHaveLength(1);
  });

  it("marca cada functionDeclaration como BLOCKING para que el turno espere el resultado", () => {
    const setup = conversationSetup();

    for (const declaration of setup.tools?.[0]?.functionDeclarations ?? []) {
      expect(declaration.behavior).toBe("BLOCKING");
    }
  });

  it("convierte los esquemas JSON a tipos Gemini sin simplificarlos", () => {
    const setup = conversationSetup();

    const parameters = setup.tools?.[0]?.functionDeclarations[0]?.parameters as {
      type: string;
      properties: Record<string, Record<string, unknown>>;
      required?: string[];
    };

    expect(parameters.type).toBe("OBJECT");
    expect(parameters.properties.status?.type).toBe("STRING");
    expect(parameters.properties.status?.enum).toEqual(["completed", "error"]);
    expect(parameters.properties.limit?.type).toBe("NUMBER");
    expect(parameters.properties.nested?.type).toBe("OBJECT");
    expect(
      (parameters.properties.nested?.properties as Record<string, { type: string }>).query.type,
    ).toBe("STRING");
    expect(parameters.properties.nested?.required).toEqual(["query"]);
    expect(parameters.properties.empty?.properties).toEqual({});
    expect(parameters.required).toEqual(["status"]);
  });

  it("NO fija sessionResumption ni contextWindowCompression: los aporta el cliente en su setup", () => {
    const setup = conversationSetup();

    expect(setup).not.toHaveProperty("sessionResumption");
    expect(setup).not.toHaveProperty("contextWindowCompression");
    expect(setup).not.toHaveProperty("inputAudioTranscription");
    expect(setup).not.toHaveProperty("outputAudioTranscription");
  });

  it("no duplica el prefijo models/ si el modelo ya lo trae", () => {
    const setup = conversationSetup("models/gemini-3.8-live");

    expect(setup.model).toBe("models/gemini-3.8-live");
  });

  it("omite tools cuando no hay declaraciones", () => {
    const setup = buildLiveConnectConstraints({
      purpose: "conversation",
      model: "gemini-3.8-live",
      systemInstruction: "prompt",
      tools: [],
    });

    expect(setup.tools).toBeUndefined();
  });
});

describe("buildLiveConnectConstraints · transcripción", () => {
  it("mintea el modelo de transcripción sin systemInstruction ni tools", () => {
    const setup = buildLiveConnectConstraints({
      purpose: "transcription",
      model: "gemini-3.5-transcribe-live",
    });

    expect(setup.model).toBe("models/gemini-3.5-transcribe-live");
    expect(setup.generationConfig).toEqual({ responseModalities: ["TEXT"] });
    expect(setup.inputAudioTranscription).toEqual({ languageCodes: [] });
    expect(setup.systemInstruction).toBeUndefined();
    expect(setup.tools).toBeUndefined();
    expect(setup).not.toHaveProperty("sessionResumption");
    expect(setup).not.toHaveProperty("contextWindowCompression");
  });

  it("ignora instrucción y tools si igual se pasan en propósito transcripción", () => {
    const setup = buildLiveConnectConstraints({
      purpose: "transcription",
      model: "gemini-3.5-transcribe-live",
      systemInstruction: "no debería viajar",
      tools: READ_ONLY_SAMPLE,
    });

    expect(setup.systemInstruction).toBeUndefined();
    expect(setup.tools).toBeUndefined();
  });
});

describe("buildAuthTokenRequestBody", () => {
  it("usa uses: 1 y el campo verificado bidiGenerateContentSetup", () => {
    const setup = conversationSetup();

    const now = new Date("2026-09-15T12:00:00.000Z");
    const body = buildAuthTokenRequestBody({ setup, now });

    expect(body.uses).toBe(1);
    expect(body.bidiGenerateContentSetup).toEqual(setup);
    expect(body).not.toHaveProperty("liveConnectConstraints");
    expect(body.newSessionExpireTime).toBe(new Date(now.getTime() + 2 * 60_000).toISOString());
    expect(new Date(body.expireTime).getTime()).toBeGreaterThan(now.getTime());
  });
});

describe("parseAuthTokenResponse", () => {
  it("acepta una respuesta con name y expireTime", () => {
    const parsed = parseAuthTokenResponse({
      name: "auth_tokens/abc-123",
      expireTime: "2026-09-15T12:30:00.000Z",
    });

    expect(parsed.name).toBe("auth_tokens/abc-123");
    expect(parsed.expireTime).toBe("2026-09-15T12:30:00.000Z");
  });

  it("acepta name sin expireTime", () => {
    const parsed = parseAuthTokenResponse({ name: "auth_tokens/abc-123" });

    expect(parsed.name).toBe("auth_tokens/abc-123");
    expect(parsed.expireTime).toBeNull();
  });

  it("lanza ante una respuesta sin name", () => {
    expect(() => parseAuthTokenResponse({})).toThrow(/name/);
    expect(() => parseAuthTokenResponse({ name: "   " })).toThrow(/name/);
    expect(() => parseAuthTokenResponse(null)).toThrow(/name/);
    expect(() => parseAuthTokenResponse("auth_tokens/x")).toThrow(/name/);
  });
});
