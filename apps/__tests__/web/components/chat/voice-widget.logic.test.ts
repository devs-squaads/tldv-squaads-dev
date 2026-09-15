/// <reference types="bun" />

import { describe, expect, it } from "bun:test";

import {
  buildVoiceDisplayMessages,
  mergeTranscriptText,
  voiceStatusLabel,
} from "../../../../web/src/components/chat/voiceWidget.logic";
import type { DisplayMessage } from "../../../../web/src/components/chat/useChatStream";

describe("voiceStatusLabel", () => {
  it("describe cada estado en español", () => {
    expect(voiceStatusLabel("idle", "listening")).toBe("Voz lista");
    expect(voiceStatusLabel("requesting-token", "listening")).toBe("Pidiendo acceso...");
    expect(voiceStatusLabel("connecting", "listening")).toBe("Conectando...");
    expect(voiceStatusLabel("active", "listening")).toBe("Escuchando...");
    expect(voiceStatusLabel("active", "speaking")).toBe("Hablando...");
    expect(voiceStatusLabel("reconnecting", "listening")).toBe("Reconectando...");
    expect(voiceStatusLabel("ended", "listening")).toBe("Sesión finalizada");
    expect(voiceStatusLabel("error", "listening")).toBe("Error de voz");
  });
});

describe("mergeTranscriptText", () => {
  it("acepta transcripciones acumulativas y delta", () => {
    expect(mergeTranscriptText("", "hola")).toBe("hola");
    expect(mergeTranscriptText("hola", "hola mundo")).toBe("hola mundo");
    expect(mergeTranscriptText("hola", " mundo")).toBe("hola mundo");
    expect(mergeTranscriptText("hola", "hola")).toBe("hola");
    expect(mergeTranscriptText("hola", "")).toBe("hola");
  });
});

describe("buildVoiceDisplayMessages", () => {
  const base: DisplayMessage[] = [{ role: "assistant", content: "hola" }];

  it("deja los mensajes intactos sin transcripciones en vivo", () => {
    const result = buildVoiceDisplayMessages({
      messages: base,
      liveUserText: "",
      liveAssistantText: "",
    });

    expect(result).toBe(base);
  });

  it("añade las transcripciones en vivo al final (los turnos cerrados ya están en messages)", () => {
    const result = buildVoiceDisplayMessages({
      messages: [
        ...base,
        { role: "user", content: "¿Qué se decidió?" },
        { role: "assistant", content: "Se aprobó el presupuesto." },
      ],
      liveUserText: "y el",
      liveAssistantText: "un momento",
    });

    expect(result).toEqual([
      { role: "assistant", content: "hola" },
      { role: "user", content: "¿Qué se decidió?" },
      { role: "assistant", content: "Se aprobó el presupuesto." },
      { role: "user", content: "y el" },
      { role: "assistant", content: "un momento", isStreaming: true },
    ]);
  });

  it("ignora transcripciones en vivo vacías", () => {
    const result = buildVoiceDisplayMessages({
      messages: base,
      liveUserText: "   ",
      liveAssistantText: "",
    });

    expect(result).toBe(base);
  });
});
