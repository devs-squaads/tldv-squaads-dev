/// <reference types="bun" />

import { describe, expect, it } from "bun:test";

import { buildLiveConnectConstraints } from "../../../../../web/src/modules/chat/voice/liveTokenRequest";
import type { ToolDefinition } from "../../../../../web/src/integrations/chat/tools/types";

/**
 * Guarda de la REGLA DEL PROYECTO: **nunca** se fija un tope de tokens de salida en una llamada
 * a un LLM (ver `apps/worker/src/services/aiModels.ts`).
 *
 * En la voz aplica igual: un `maxOutputTokens` acá truncaría la respuesta hablada, y `thinkingConfig`
 * no está soportado en `gemini-3.8-live` (la migración pide omitirlo explícitamente).
 *
 * Este test recorre el payload **completo** en profundidad, así que también detecta un tope anidado
 * que se cuele dentro de `generationConfig`, de una tool o de cualquier campo futuro.
 */
const FORBIDDEN_KEYS = [
  "max_tokens",
  "maxTokens",
  "maxOutputTokens",
  "max_output_tokens",
  "max_new_tokens",
  "maxtokens",
  "thinkingConfig",
  "thinking_config",
  "thinkingBudget",
  "thinking_level",
  "thinkingLevel",
  "stopSequences",
  "stop_sequences",
  "candidateCount",
  "candidate_count",
] as const;

const SAMPLE_TOOLS: ToolDefinition[] = [
  {
    name: "search_meetings",
    description: "Busca reuniones",
    parameters: {
      type: "object",
      properties: { status: { type: "string" } },
      required: ["status"],
    },
    execute: async () => [],
  },
];

/** Devuelve las claves prohibidas encontradas en cualquier nivel del payload. */
function findForbiddenKeys(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) findForbiddenKeys(item, found);
    return found;
  }

  if (typeof value === "object" && value !== null) {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if ((FORBIDDEN_KEYS as readonly string[]).includes(key)) found.push(key);
      findForbiddenKeys(nested, found);
    }
  }

  return found;
}

describe("regla del proyecto: sin topes de tokens de salida en la voz", () => {
  it("las restricciones de conversación no fijan ningún tope de tokens ni thinking", () => {
    const setup = buildLiveConnectConstraints({
      purpose: "conversation",
      model: "gemini-3.8-live",
      systemInstruction: "Sos el asistente de Squaads.",
      tools: SAMPLE_TOOLS,
    });

    expect(findForbiddenKeys(setup)).toEqual([]);
  });

  it("las restricciones de transcripción tampoco fijan topes", () => {
    const setup = buildLiveConnectConstraints({
      purpose: "transcription",
      model: "gemini-3.5-transcribe-live",
    });

    expect(findForbiddenKeys(setup)).toEqual([]);
  });

  it("la configuración de generación de la conversación es exactamente la modalidad de audio", () => {
    const setup = buildLiveConnectConstraints({
      purpose: "conversation",
      model: "gemini-3.8-live",
      tools: SAMPLE_TOOLS,
    });

    // `toEqual` exige igualdad estricta: agregar cualquier campo (p. ej. un tope) rompe este test.
    expect(setup.generationConfig).toEqual({ responseModalities: ["AUDIO"] });
  });

  it("la configuración de generación de la transcripción es exactamente la modalidad de texto", () => {
    const setup = buildLiveConnectConstraints({
      purpose: "transcription",
      model: "gemini-3.5-transcribe-live",
    });

    expect(setup.generationConfig).toEqual({ responseModalities: ["TEXT"] });
  });

  it("el setup de conversación solo lleva modelo, modalidad, instrucción y tools", () => {
    const setup = buildLiveConnectConstraints({
      purpose: "conversation",
      model: "gemini-3.8-live",
      systemInstruction: "prompt",
      tools: SAMPLE_TOOLS,
    });

    expect(Object.keys(setup).sort()).toEqual([
      "generationConfig",
      "model",
      "systemInstruction",
      "tools",
    ]);
  });
});
