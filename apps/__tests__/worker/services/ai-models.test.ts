/// <reference types="bun" />

import { describe, expect, it } from "bun:test";
import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_TEXT_MODEL,
  DEFAULT_TRANSCRIPTION_MODEL,
  resolveAiModels,
} from "../../../worker/src/services/aiModels";

describe("resolveAiModels (spec 016)", () => {
  it("uses the verified defaults when nothing is configured", () => {
    const { models, warnings } = resolveAiModels({});

    expect(models.transcriptionModel).toBe(DEFAULT_TRANSCRIPTION_MODEL);
    expect(models.textModel).toBe(DEFAULT_TEXT_MODEL);
    expect(models.geminiModel).toBe(DEFAULT_GEMINI_MODEL);
    expect(warnings).toEqual([]);
  });

  it("never defaults to the model that broke the pipeline", () => {
    const { models } = resolveAiModels({});

    expect(models.textModel).not.toBe("llama-3.3-70b-versatile");
  });

  it("honours an explicitly configured model", () => {
    const { models, warnings } = resolveAiModels({ GROQ_TEXT_MODEL: "deepseek-v4.1-flash" });

    expect(models.textModel).toBe("deepseek-v4.1-flash");
    expect(warnings).toEqual([]);
  });

  it("honours the transcription and gemini overrides independently", () => {
    const { models } = resolveAiModels({
      GROQ_TRANSCRIPTION_MODEL: "whisper-large-v3-turbo",
      GEMINI_MODEL: "gemini-3.5-transcribe",
    });

    expect(models.transcriptionModel).toBe("whisper-large-v3-turbo");
    expect(models.geminiModel).toBe("gemini-3.5-transcribe");
    expect(models.textModel).toBe(DEFAULT_TEXT_MODEL);
  });

  it("discards a retired model instead of failing at runtime, and says why", () => {
    const { models, warnings } = resolveAiModels({ GROQ_TEXT_MODEL: "llama-3.3-70b-versatile" });

    expect(models.textModel).toBe(DEFAULT_TEXT_MODEL);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("llama-3.3-70b-versatile");
    expect(warnings[0]).toContain("GROQ_TEXT_MODEL");
  });

  it("treats a blank value as unset", () => {
    const { models, warnings } = resolveAiModels({ GROQ_TEXT_MODEL: "   ", GEMINI_MODEL: "" });

    expect(models.textModel).toBe(DEFAULT_TEXT_MODEL);
    expect(models.geminiModel).toBe(DEFAULT_GEMINI_MODEL);
    expect(warnings).toEqual([]);
  });

  it("trims a configured value with stray whitespace", () => {
    const { models } = resolveAiModels({ GROQ_TEXT_MODEL: "  openai/gpt-oss-20b  " });

    expect(models.textModel).toBe("openai/gpt-oss-20b");
  });
});

describe("regla: nunca se fija max_tokens (spec 017)", () => {
  it("no expone ninguna función de presupuesto de salida", async () => {
    // Un tope artificial trunca la respuesta y en este pipeline truncar es perder contenido.
    const mod = await import("../../../worker/src/services/aiModels");
    expect("resolveTextOutputBudget" in mod).toBe(false);
  });
});
