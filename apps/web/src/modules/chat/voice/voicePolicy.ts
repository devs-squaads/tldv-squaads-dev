/**
 * Política de la voz en tiempo real (feature 018).
 *
 * Módulo puro: toda la variación de configuración vive acá y se resuelve desde
 * el entorno. El resto del sistema (rutas, cliente) consume esta política sin
 * ramificar por proveedor.
 */

export const VOICE_CHAT_DEFAULT_MODEL = "gemini-3.8-live";
export const VOICE_CHAT_DEFAULT_MAX_SESSION_MINUTES = 15;

/**
 * Rate limit del minteo de tokens. Es una constante del módulo (no una variable
 * de entorno): el cupo es una decisión de producto, no de despliegue.
 */
export const VOICE_CHAT_TOKEN_RATE_LIMIT = 10;
export const VOICE_CHAT_TOKEN_RATE_LIMIT_WINDOW_MS = 60_000;

export interface VoiceRateLimitPolicy {
  limit: number;
  windowMs: number;
}

export interface VoiceChatPolicy {
  enabled: boolean;
  model: string;
  maxSessionMinutes: number;
  rateLimit: VoiceRateLimitPolicy;
  /** Explicación legible de por qué quedó así (para logs y diagnóstico). */
  reason: string;
}

export type VoiceEnv = Record<string, string | undefined>;

function parsePositiveInteger(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function resolveVoicePolicy(env: VoiceEnv = process.env): VoiceChatPolicy {
  const rawEnabled = env.VOICE_CHAT_ENABLED?.trim().toLowerCase();
  const enabled = rawEnabled === "true";

  const rawModel = env.GEMINI_LIVE_MODEL?.trim();
  const model = rawModel && rawModel.length > 0 ? rawModel : VOICE_CHAT_DEFAULT_MODEL;

  const rawMaxSessionMinutes = env.VOICE_CHAT_MAX_SESSION_MINUTES?.trim();
  const parsedMaxSessionMinutes = parsePositiveInteger(rawMaxSessionMinutes);
  const warnings: string[] = [];
  let maxSessionMinutes = VOICE_CHAT_DEFAULT_MAX_SESSION_MINUTES;

  if (rawMaxSessionMinutes) {
    if (parsedMaxSessionMinutes === null) {
      warnings.push(
        `VOICE_CHAT_MAX_SESSION_MINUTES="${rawMaxSessionMinutes}" inválido; se usa el default ${VOICE_CHAT_DEFAULT_MAX_SESSION_MINUTES}`,
      );
    } else {
      maxSessionMinutes = parsedMaxSessionMinutes;
    }
  }

  const reason = [
    enabled
      ? "Voz habilitada por VOICE_CHAT_ENABLED=true"
      : "Voz apagada por defecto (VOICE_CHAT_ENABLED distinto de true)",
    ...warnings,
  ].join(" · ");

  return {
    enabled,
    model,
    maxSessionMinutes,
    rateLimit: {
      limit: VOICE_CHAT_TOKEN_RATE_LIMIT,
      windowMs: VOICE_CHAT_TOKEN_RATE_LIMIT_WINDOW_MS,
    },
    reason,
  };
}
