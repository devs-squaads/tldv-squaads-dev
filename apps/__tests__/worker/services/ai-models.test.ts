/// <reference types="bun" />

import { describe, expect, it } from "bun:test";
import {
  DEFAULT_DEEPSEEK_MODEL,
  DEFAULT_GEMINI_MODEL,
  RETIRED_MODELS,
  resolveAiModels,
} from "../../../worker/src/services/aiModels";

describe("resolveAiModels (spec 016/017)", () => {
  it("uses the verified defaults when nothing is configured", () => {
    const { models, warnings } = resolveAiModels({});

    expect(models.geminiModel).toBe(DEFAULT_GEMINI_MODEL);
    expect(models.deepseekModel).toBe(DEFAULT_DEEPSEEK_MODEL);
    expect(warnings).toEqual([]);
  });

  it("separates the audio model (Gemini) from the text model (DeepSeek)", () => {
    const { models } = resolveAiModels({});

    expect(models.geminiModel).toBe("gemini-3.8-flash");
    expect(models.deepseekModel).toBe("deepseek-flash");
  });

  it("never defaults to a Groq model", () => {
    const { models } = resolveAiModels({});
    const values = [models.geminiModel, models.deepseekModel];

    expect(
      values.some((v) => v.includes("llama") || v.includes("gpt-oss") || v.includes("whisper")),
    ).toBe(false);
  });

  it("honours explicitly configured models", () => {
    const { models, warnings } = resolveAiModels({
      GEMINI_MODEL: "gemini-3.5-transcribe",
      DEEPSEEK_MODEL: "deepseek-v4-pro",
    });

    expect(models.geminiModel).toBe("gemini-3.5-transcribe");
    expect(models.deepseekModel).toBe("deepseek-v4-pro");
    expect(warnings).toEqual([]);
  });

  it("discards a retired DeepSeek model instead of failing at runtime, and says why", () => {
    const { models, warnings } = resolveAiModels({ DEEPSEEK_MODEL: "deepseek-v4-flash" });

    expect(models.deepseekModel).toBe(DEFAULT_DEEPSEEK_MODEL);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("deepseek-v4-flash");
    expect(warnings[0]).toContain("DEEPSEEK_MODEL");
  });

  it("discards the Groq models that were in use before", () => {
    const { models, warnings } = resolveAiModels({ DEEPSEEK_MODEL: "openai/gpt-oss-120b" });

    expect(models.deepseekModel).toBe(DEFAULT_DEEPSEEK_MODEL);
    expect(warnings[0]).toContain("openai/gpt-oss-120b");
  });

  it("declares the retired Groq models so an old .env cannot resurrect them", () => {
    expect(RETIRED_MODELS).toContain("llama-3.3-70b-versatile");
    expect(RETIRED_MODELS).toContain("openai/gpt-oss-120b");
    expect(RETIRED_MODELS).toContain("whisper-large-v3");
  });

  it("treats a blank value as unset", () => {
    const { models, warnings } = resolveAiModels({ GEMINI_MODEL: "   ", DEEPSEEK_MODEL: "" });

    expect(models.geminiModel).toBe(DEFAULT_GEMINI_MODEL);
    expect(models.deepseekModel).toBe(DEFAULT_DEEPSEEK_MODEL);
    expect(warnings).toEqual([]);
  });

  it("trims a configured value with stray whitespace", () => {
    const { models } = resolveAiModels({ GEMINI_MODEL: "  gemini-3.7-flash  " });

    expect(models.geminiModel).toBe("gemini-3.7-flash");
  });
});

describe("regla: nunca se fija max_tokens (spec 017)", () => {
  it("no expone ninguna función de presupuesto de salida", async () => {
    // Un tope artificial trunca la respuesta y en este pipeline truncar es perder contenido.
    const mod = await import("../../../worker/src/services/aiModels");
    expect("resolveTextOutputBudget" in mod).toBe(false);
  });
});
