/// <reference types="bun" />

import { describe, expect, it } from "bun:test";

import {
  VOICE_CHAT_DEFAULT_MAX_SESSION_MINUTES,
  VOICE_CHAT_DEFAULT_MODEL,
  VOICE_CHAT_TOKEN_RATE_LIMIT,
  VOICE_CHAT_TOKEN_RATE_LIMIT_WINDOW_MS,
  resolveVoicePolicy,
} from "../../../../../web/src/modules/chat/voice/voicePolicy";

describe("resolveVoicePolicy", () => {
  it("está apagada por defecto y expone los valores por defecto verificados", () => {
    const policy = resolveVoicePolicy({});

    expect(policy.enabled).toBe(false);
    expect(policy.model).toBe(VOICE_CHAT_DEFAULT_MODEL);
    expect(policy.model).toBe("gemini-3.8-live");
    expect(policy.maxSessionMinutes).toBe(VOICE_CHAT_DEFAULT_MAX_SESSION_MINUTES);
    expect(policy.maxSessionMinutes).toBe(15);
    expect(policy.rateLimit).toEqual({
      limit: VOICE_CHAT_TOKEN_RATE_LIMIT,
      windowMs: VOICE_CHAT_TOKEN_RATE_LIMIT_WINDOW_MS,
    });
    expect(policy.reason.toLowerCase()).toContain("apagada");
  });

  it("se enciende solo con VOICE_CHAT_ENABLED=true (tolerando espacios y mayúsculas)", () => {
    expect(resolveVoicePolicy({ VOICE_CHAT_ENABLED: "true" }).enabled).toBe(true);
    expect(resolveVoicePolicy({ VOICE_CHAT_ENABLED: " TRUE " }).enabled).toBe(true);
    expect(resolveVoicePolicy({ VOICE_CHAT_ENABLED: "false" }).enabled).toBe(false);
    expect(resolveVoicePolicy({ VOICE_CHAT_ENABLED: "1" }).enabled).toBe(false);
  });

  it("usa GEMINI_LIVE_MODEL cuando está definido y cae al default si está vacío", () => {
    expect(resolveVoicePolicy({ GEMINI_LIVE_MODEL: "gemini-4.0-live" }).model).toBe("gemini-4.0-live");
    expect(resolveVoicePolicy({ GEMINI_LIVE_MODEL: "   " }).model).toBe(VOICE_CHAT_DEFAULT_MODEL);
  });

  it("usa VOICE_CHAT_MAX_SESSION_MINUTES cuando es un entero positivo", () => {
    expect(resolveVoicePolicy({ VOICE_CHAT_MAX_SESSION_MINUTES: "30" }).maxSessionMinutes).toBe(30);
    expect(resolveVoicePolicy({ VOICE_CHAT_MAX_SESSION_MINUTES: " 45 " }).maxSessionMinutes).toBe(45);
  });

  it("cae al default con motivo cuando el tope es inválido", () => {
    for (const invalid of ["abc", "0", "-3", "12.5"]) {
      const policy = resolveVoicePolicy({ VOICE_CHAT_MAX_SESSION_MINUTES: invalid });
      expect(policy.maxSessionMinutes).toBe(VOICE_CHAT_DEFAULT_MAX_SESSION_MINUTES);
      expect(policy.reason).toContain(invalid);
      expect(policy.reason.toLowerCase()).toContain("inválido");
    }
  });

  it("mantiene el rate limit como constante del módulo, no como variable de entorno", () => {
    const policy = resolveVoicePolicy({
      VOICE_CHAT_ENABLED: "true",
      // Cualquier intento de override por env debe ignorarse: es política del módulo.
      VOICE_CHAT_RATE_LIMIT: "999",
      VOICE_CHAT_RATE_LIMIT_WINDOW_MS: "1",
    } as Record<string, string | undefined>);

    expect(policy.rateLimit).toEqual({
      limit: VOICE_CHAT_TOKEN_RATE_LIMIT,
      windowMs: VOICE_CHAT_TOKEN_RATE_LIMIT_WINDOW_MS,
    });
  });
});
