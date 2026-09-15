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
 *    de la tool y el asistente se queda sin responder;
 *  - hay dos sockets con propósitos distintos: **conversación**
 *    (`responseModalities: ["AUDIO"]` + prompt + tools) y **transcripción del
 *    usuario** (`responseModalities: ["TEXT"]` + `inputAudioTranscription`).
 *    `gemini-3.8-live` acepta `inputAudioTranscription` pero **no emite nunca**
 *    `inputTranscription`, por eso la voz del usuario se transcribe en un
 *    segundo socket con `gemini-3.5-transcribe-live`.
 */

import { toGeminiSchema } from "@/integrations/chat/tools/geminiSchema";
import type { ToolDefinition } from "@/integrations/chat/tools/types";

export type LiveTokenPurpose = "conversation" | "transcription";

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
  systemInstruction?: { parts: Array<{ text: string }> };
  tools?: LiveToolGroup[];
  inputAudioTranscription?: { languageCodes: string[] };
}

export interface BuildLiveConnectConstraintsInput {
  model: string;
  /** Default `"conversation"`. */
  purpose?: LiveTokenPurpose;
  systemInstruction?: string;
  tools?: readonly ToolDefinition[];
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

/**
 * Restricciones de conversación: **solo** modelo, modalidad, instrucción y tools.
 * `sessionResumption` y `contextWindowCompression` NO se fijan acá: el servidor
 * ya habilita la resumption por defecto (manda el handle) y el cliente aporta
 * ambos campos en su propio `setup`. Bloquearlos en el token dejaría sin
 * verificar la combinación "handle del cliente + config bloqueada" justo en la
 * reconexión de los ~10 minutos.
 */
function buildConversationSetup(
  input: BuildLiveConnectConstraintsInput,
): BidiGenerateContentSetup {
  const functionDeclarations = (input.tools ?? []).map(toLiveFunctionDeclaration);

  const setup: BidiGenerateContentSetup = {
    model: withModelsPrefix(input.model),
    generationConfig: { responseModalities: ["AUDIO"] },
  };

  if (input.systemInstruction) {
    setup.systemInstruction = { parts: [{ text: input.systemInstruction }] };
  }

  if (functionDeclarations.length > 0) {
    setup.tools = [{ functionDeclarations }];
  }

  return setup;
}

function buildTranscriptionSetup(
  input: BuildLiveConnectConstraintsInput,
): BidiGenerateContentSetup {
  return {
    model: withModelsPrefix(input.model),
    generationConfig: { responseModalities: ["TEXT"] },
    inputAudioTranscription: { languageCodes: [] },
  };
}

export function buildLiveConnectConstraints(
  input: BuildLiveConnectConstraintsInput,
): BidiGenerateContentSetup {
  return input.purpose === "transcription"
    ? buildTranscriptionSetup(input)
    : buildConversationSetup(input);
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
