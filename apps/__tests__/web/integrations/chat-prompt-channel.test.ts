/// <reference types="bun" />

import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";

import {
  BASE_CHAT_RULES,
  STATIC_KNOWLEDGE,
  VOICE_CHAT_RULES,
} from "../../../web/src/integrations/chat/knowledge/staticKnowledge";
import { assembleChatSystemPrompt } from "../../../web/src/integrations/chat/knowledge/promptAssembler";

// Byte-lock del prompt de texto: el chat de texto no puede cambiar.
const BASE_CHAT_RULES_SHA256 = "fd62cc8ccdf77ab9b9dee407ec3448f12ff7c4ac1446cfb486f0dc0a7a9ffe8b";
const BASE_CHAT_RULES_LENGTH = 1472;

describe("staticKnowledge · reglas por canal", () => {
  it("BASE_CHAT_RULES queda byte-idéntico al prompt de texto actual", () => {
    const sha = createHash("sha256").update(BASE_CHAT_RULES, "utf8").digest("hex");

    expect(BASE_CHAT_RULES.length).toBe(BASE_CHAT_RULES_LENGTH);
    expect(sha).toBe(BASE_CHAT_RULES_SHA256);
    expect(BASE_CHAT_RULES).toContain("[SUGGESTIONS]");
    expect(STATIC_KNOWLEDGE).toBe(BASE_CHAT_RULES);
  });

  it("VOICE_CHAT_RULES prohíbe el bloque de sugerencias y el JSON", () => {
    expect(VOICE_CHAT_RULES).not.toContain("[SUGGESTIONS]");
    // El núcleo compartido menciona "payload.id" en la regla anti-alucinación
    // (y debe quedar byte-idéntico); lo que no puede aparecer es el bloque JSON
    // de sugerencias con payload.
    expect(VOICE_CHAT_RULES).not.toContain('"payload"');
    expect(VOICE_CHAT_RULES).not.toContain('"label"');
    expect(VOICE_CHAT_RULES).toContain("voz");
    // Conserva el núcleo compartido (identidad, alcance, anti-alucinación).
    expect(VOICE_CHAT_RULES).toContain("Sos el asistente de Squaads Bot");
    expect(VOICE_CHAT_RULES).toContain("Reglas anti-alucinación");
  });
});

describe("assembleChatSystemPrompt · canal", () => {
  const input = {
    messages: [{ role: "user", content: "hola" }],
    userContext: "Contexto de prueba",
    topK: 0,
  };

  it("sin channel (o channel text) mantiene el systemContent de siempre", () => {
    const legacy = assembleChatSystemPrompt(input);
    const explicitText = assembleChatSystemPrompt({ ...input, channel: "text" });

    expect(explicitText.systemContent).toBe(legacy.systemContent);
    expect(legacy.systemContent).toContain("[SUGGESTIONS]");
  });

  it("con channel voice no incluye el bloque de sugerencias", () => {
    const voice = assembleChatSystemPrompt({ ...input, channel: "voice" });

    expect(voice.systemContent).not.toContain("[SUGGESTIONS]");
    expect(voice.systemContent).toContain("voz");
  });
});
