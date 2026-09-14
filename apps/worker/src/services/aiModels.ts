/**
 * Resolución de los identificadores de modelo del pipeline de IA (spec 016/017).
 *
 * Módulo puro: recibe el entorno, devuelve la configuración. Existe porque los modelos estaban
 * hardcodeados en cuatro servicios y uno de ellos (`llama-3.3-70b-versatile`) desapareció de la
 * cuenta de Groq, dejando caer en silencio la diarización, el refiner y el resumen.
 *
 * Reparto desde la 017: **Gemini para audio** (transcribe y diariza de forma acústica) y **DeepSeek
 * para texto** (refiner y resumen). Groq queda fuera del proyecto.
 *
 * Los valores por defecto NO son de memoria: se verificaron con llamadas reales contra las APIs
 * (ver `spec/features/017-text-provider-deepseek/plan.md`).
 */

export interface AiModelConfig {
  /** Gemini: transcripción con audio (y respaldo de texto). */
  geminiModel: string;
  /** DeepSeek: refiner y resumen. */
  deepseekModel: string;
}

export interface ResolvedAiModels {
  models: AiModelConfig;
  /** Motivos por los que un valor configurado se descartó. Vacío si todo se respetó. */
  warnings: string[];
}

/** Verificado: transcribió 53,5 min de audio en 63,5 s, con diarización acústica. */
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
/** Verificado: responde al API compatible con OpenAI y reemite texto fielmente. */
export const DEFAULT_DEEPSEEK_MODEL = "deepseek-flash";

/**
 * Modelos que estuvieron en uso y ya no valen. Si alguien los configura (porque los copió de un
 * `.env` viejo o del README anterior), se descartan con aviso en vez de romper el pipeline en
 * tiempo de ejecución.
 *
 * `deepseek-v4-flash` y `deepseek-v4-flash-vision-exp` están retirados según la documentación de
 * DeepSeek: el nombre vigente es `deepseek-flash`. Los de Groq se descartan porque el proyecto ya no
 * usa Groq.
 */
export const RETIRED_MODELS: ReadonlyArray<string> = [
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "whisper-large-v3",
  "whisper-large-v3-turbo",
  "deepseek-v4-flash",
  "deepseek-v4-flash-vision-exp",
];

function resolveModel(
  rawValue: string | undefined,
  fallback: string,
  envName: string,
  warnings: string[],
): string {
  const candidate = rawValue?.trim();

  if (!candidate) {
    return fallback;
  }

  if (RETIRED_MODELS.includes(candidate)) {
    warnings.push(
      `${envName}="${candidate}" ya no está disponible; se usa "${fallback}".`,
    );
    return fallback;
  }

  return candidate;
}

export function resolveAiModels(
  env: Record<string, string | undefined> = process.env,
): ResolvedAiModels {
  const warnings: string[] = [];

  return {
    models: {
      geminiModel: resolveModel(env.GEMINI_MODEL, DEFAULT_GEMINI_MODEL, "GEMINI_MODEL", warnings),
      deepseekModel: resolveModel(
        env.DEEPSEEK_MODEL,
        DEFAULT_DEEPSEEK_MODEL,
        "DEEPSEEK_MODEL",
        warnings,
      ),
    },
    warnings,
  };
}

/**
 * REGLA DEL PROYECTO: nunca se fija `max_tokens` en una llamada a un LLM.
 *
 * No hay función de presupuesto de salida a propósito. Un tope artificial trunca la respuesta, y en
 * este pipeline truncar significa perder contenido de la reunión. Medido: con `max_tokens: 8000` la
 * atribución de hablantes se cortó al 55 % de la entrada; sin el tope, completa.
 *
 * Los modelos de razonamiento agravan el problema porque gastan tokens **antes** de emitir texto y
 * cuentan contra el mismo tope. Si algún proveedor impone su propio límite, la guarda de fidelidad
 * (`finish_reason === "length"` + ratio de caracteres) lo detecta y conserva el contenido original.
 */

const alreadyWarned = new Set<string>();

/**
 * Igual que `resolveAiModels`, pero avisa una sola vez por proceso cuando un valor configurado se
 * descarta. Se separa de la versión pura para poder testear la decisión sin capturar logs.
 */
export function getAiModels(env: Record<string, string | undefined> = process.env): AiModelConfig {
  const { models, warnings } = resolveAiModels(env);

  for (const warning of warnings) {
    if (!alreadyWarned.has(warning)) {
      alreadyWarned.add(warning);
      console.warn(`[aiModels] ${warning}`);
    }
  }

  return models;
}
