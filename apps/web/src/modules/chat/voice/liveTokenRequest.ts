/**
 * Constructor de payloads para el minteo de tokens efímeros de Gemini Live.
 *
 * Módulo puro: no hace red. Fija la forma **verificada contra la API real**
 * (2026-09-15):
 *  - el campo de restricción es `bidiGenerateContentSetup` (no
 *    `liveConnectConstraints`, que devuelve 400);
 *  - el modelo va como `models/<modelo>`;
 *  - cada `functionDeclaration` va con `behavior: "BLOCKING"`, porque con el
 *    default `NON_BLOCKING` el turno cierra antes de que vuelva el resultado
 *    de la tool y el asistente se queda sin responder.
 */

import { toGeminiSchema } from "@/integrations/chat/tools/geminiSchema";
import type { ToolDefinition } from "@/integrations/chat/tools/types";

export interface LiveFunctionDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  behavior: "BLOCKING";
}

export interface LiveToolGroup {
  functionDeclarations: LiveFunctionDeclaration[];
}

export interface BidiGenerateContentSetup {
  model: string;
  generationConfig: { responseModalities: string[] };
  systemInstruction: { parts: Array<{ text: string }> };
  tools?: LiveToolGroup[];
}

export interface BuildLiveConnectConstraintsInput {
  model: string;
  systemInstruction: string;
  tools: readonly ToolDefinition[];
}

export interface AuthTokenRequestBody {
  uses: number;
  expireTime: string;
  newSessionExpireTime: string;
  bidiGenerateContentSetup: BidiGenerateContentSetup;
}

/** Vida del token: alcanza para abrir la sesión y sostenerla con reconexión. */
export const AUTH_TOKEN_LIFETIME_MS = 30 * 60_000;
/** Ventana para abrir la primera conexión con el token recién minteado. */
export const AUTH_TOKEN_NEW_SESSION_WINDOW_MS = 2 * 60_000;

function toLiveFunctionDeclaration(tool: ToolDefinition): LiveFunctionDeclaration {
  return {
    name: tool.name,
    description: tool.description,
    parameters: toGeminiSchema(tool.parameters as unknown as Record<string, unknown>),
    behavior: "BLOCKING",
  };
}

function withModelsPrefix(model: string): string {
  const trimmed = model.trim();
  return trimmed.startsWith("models/") ? trimmed : `models/${trimmed}`;
}

export function buildLiveConnectConstraints(
  input: BuildLiveConnectConstraintsInput,
): BidiGenerateContentSetup {
  const functionDeclarations = input.tools.map(toLiveFunctionDeclaration);

  const setup: BidiGenerateContentSetup = {
    model: withModelsPrefix(input.model),
    generationConfig: { responseModalities: ["AUDIO"] },
    systemInstruction: { parts: [{ text: input.systemInstruction }] },
  };

  if (functionDeclarations.length > 0) {
    setup.tools = [{ functionDeclarations }];
  }

  return setup;
}

export function buildAuthTokenRequestBody(input: {
  setup: BidiGenerateContentSetup;
  now?: Date;
  newSessionExpireMs?: number;
  tokenLifetimeMs?: number;
}): AuthTokenRequestBody {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();

  return {
    uses: 1,
    expireTime: new Date(nowMs + (input.tokenLifetimeMs ?? AUTH_TOKEN_LIFETIME_MS)).toISOString(),
    newSessionExpireTime: new Date(
      nowMs + (input.newSessionExpireMs ?? AUTH_TOKEN_NEW_SESSION_WINDOW_MS),
    ).toISOString(),
    bidiGenerateContentSetup: input.setup,
  };
}

export interface ParsedAuthToken {
  name: string;
  expireTime: string | null;
}

export function parseAuthTokenResponse(payload: unknown): ParsedAuthToken {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new Error("Respuesta de auth_tokens inválida: se esperaba un objeto con el campo name");
  }

  const name = (payload as Record<string, unknown>).name;
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new Error("Respuesta de auth_tokens inválida: falta el campo name");
  }

  const expireTime = (payload as Record<string, unknown>).expireTime;

  return {
    name: name.trim(),
    expireTime: typeof expireTime === "string" && expireTime.trim().length > 0 ? expireTime : null,
  };
}
