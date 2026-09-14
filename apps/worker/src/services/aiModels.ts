/**
 * Resolución de los identificadores de modelo del pipeline de IA (spec 016).
 *
 * Módulo puro: recibe el entorno, devuelve la configuración. Existe porque los modelos estaban
 * hardcodeados en cuatro servicios y uno de ellos (`llama-3.3-70b-versatile`) desapareció de la
 * cuenta de Groq, dejando caer en silencio la diarización, el refiner y el resumen.
 *
 * Los valores por defecto NO son de memoria: se verificaron con llamadas reales contra las APIs el
 * 2026-09-14 (ver `spec/features/016-ai-pipeline-recovery/plan.md`).
 */

export interface AiModelConfig {
  /** Modelo de ASR (audio → texto). */
  transcriptionModel: string;
  /** Modelo de chat de Groq: refiner, atribución de hablantes y resumen. */
  textModel: string;
  /** Modelo de Gemini, usado como red de seguridad de los anteriores. */
  geminiModel: string;
}

export interface ResolvedAiModels {
  models: AiModelConfig;
  /** Motivos por los que un valor configurado se descartó. Vacío si todo se respetó. */
  warnings: string[];
}

/** Verificado: existe en la cuenta y transcribió 53,5 min en 14,6 s. */
export const DEFAULT_TRANSCRIPTION_MODEL = "whisper-large-v3";
/** Verificado: existe en la cuenta y respondió con JSON válido. */
export const DEFAULT_TEXT_MODEL = "openai/gpt-oss-120b";
/** Verificado: existe en la clave (1M entrada / 65k salida). */
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";

/**
 * Modelos que estuvieron en uso y ya no están disponibles. Si alguien los configura (porque los
 * copió de un `.env` viejo o del README anterior), se descartan con aviso en vez de romper el
 * pipeline en tiempo de ejecución.
 */
export const RETIRED_MODELS: ReadonlyArray<string> = ["llama-3.3-70b-versatile"];

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
      `${envName}="${candidate}" ya no está disponible en el proveedor; se usa "${fallback}".`,
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
      transcriptionModel: resolveModel(
        env.GROQ_TRANSCRIPTION_MODEL,
        DEFAULT_TRANSCRIPTION_MODEL,
        "GROQ_TRANSCRIPTION_MODEL",
        warnings,
      ),
      textModel: resolveModel(env.GROQ_TEXT_MODEL, DEFAULT_TEXT_MODEL, "GROQ_TEXT_MODEL", warnings),
      geminiModel: resolveModel(env.GEMINI_MODEL, DEFAULT_GEMINI_MODEL, "GEMINI_MODEL", warnings),
    },
    warnings,
  };
}

/**
 * Presupuesto de salida para una llamada de texto, acotado por el techo del proveedor.
 *
 * El refiner y la atribución reemiten el texto completo, así que necesitan un presupuesto del orden de
 * la entrada: los 8192 tokens anteriores truncaban cualquier reunión larga.
 *
 * El margen NO es cosmético: los modelos de razonamiento (`openai/gpt-oss-*`) gastan tokens **antes**
 * de emitir la respuesta (medido: 55 tokens para pedir una palabra), y esos tokens cuentan contra el
 * mismo presupuesto. Con un margen fijo de 2048 la atribución de una reunión de 53 min se truncó y se
 * perdieron los últimos 4 minutos en silencio.
 */
export function resolveTextOutputBudget(transcriptChars: number): number {
  const approxOutputTokens = Math.ceil(transcriptChars / 3);
  const requested = Math.ceil(approxOutputTokens * 1.4) + 4096;
  return Math.min(Math.max(requested, 4096), 32768);
}

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
