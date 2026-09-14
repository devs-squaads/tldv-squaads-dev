/**
 * Transcripción con Gemini (spec 017).
 *
 * Gemini acepta audio como entrada y, a diferencia de Whisper, **diariza de forma acústica**: distingue
 * las voces del propio audio en vez de inferirlas del texto. Medido sobre una reunión real de 53,5 min:
 *
 * | | Pipeline anterior (Whisper + atribución por LLM) | Gemini 3.8 Flash |
 * |---|---|---|
 * | Tiempo | ~125 s (15 s ASR + ~110 s atribución) | **63,5 s** |
 * | Hablantes | `Participante 1`, `Participante 2` (inferidos, reiniciados por fragmento) | **nombres reales**, consistentes |
 * | Cobertura | [53:23] con 2 de 8 fragmentos truncados | **[52:56]**, `finish=STOP` |
 *
 * Al hacer ASR y diarización en una sola petición, la identidad de los hablantes es consistente en toda
 * la reunión: desaparece el problema de reconciliación entre fragmentos.
 */
import fs from "fs";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type {
  TranscriptionProviderOptions,
  TranscriptionProviderResult,
  TranscriptionSegment,
} from "@/integrations/ai/transcription/TranscriptionProvider";
import { getAiModels } from "@/services/aiModels";
import { resolveProviderTimeoutMs, withTimeout } from "@/services/providerTimeout";

/** El límite de la API para datos en línea ronda los 20 MB de petición; se deja margen. */
export const GEMINI_INLINE_MAX_BYTES = 12 * 1024 * 1024;

const MIME_TYPES: Record<string, string> = {
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
};

export function mimeTypeFor(filePath: string): string {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "audio/ogg";
}

export function buildDiarizationPrompt(context?: string, dictionaryTerms?: string[]): string {
  const extras: string[] = [];
  if (context?.trim()) extras.push(`Contexto de la reunión: ${context.trim()}`);
  if (dictionaryTerms?.length) {
    extras.push(`Términos y nombres que debes escribir así: ${dictionaryTerms.join(", ")}`);
  }

  return `Transcribe esta reunión en español, con diarización.

FORMATO, una línea por intervención:
Nombre [MM:SS]: texto

REGLAS:
1. Identifica quién habla (diarización). Usa el nombre real si el contexto lo revela; si no, usa "Hablante 1", "Hablante 2"… Sé CONSISTENTE en TODA la reunión: la misma voz, la misma etiqueta.
2. Corta una línea NUEVA cada vez que cambie el hablante o cada 15-20 segundos como máximo. No juntes minutos enteros en una sola línea.
3. El timestamp es el segundo en que empieza esa intervención, en formato MM:SS.
4. Transcribe literalmente. No resumas, no omitas, no reescribas y no traduzcas.
5. No añadas títulos, resúmenes ni comentarios fuera de esas líneas.${extras.length ? `\n\n${extras.join("\n")}` : ""}`;
}

const DIARIZED_LINE_RE = /^(.+?)\s*\[(\d{1,3}):(\d{2})\]\s*:\s*(.+)$/;

/**
 * Convierte la salida de Gemini en segmentos.
 *
 * El final de cada segmento es el inicio del siguiente, y el del último se estima por longitud del
 * texto, porque Gemini sólo devuelve el instante de comienzo.
 */
export function parseDiarizedTranscript(raw: string, totalSeconds = 0): TranscriptionSegment[] {
  const parsed: Array<{ speaker: string; start: number; text: string }> = [];

  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const match = line.match(DIARIZED_LINE_RE);
    if (!match) continue;

    const [, speaker, minutes, seconds, text] = match;
    const cleanText = text.trim();
    if (!cleanText) continue;

    parsed.push({
      speaker: speaker.trim(),
      start: Number(minutes) * 60 + Number(seconds),
      text: cleanText,
    });
  }

  return parsed.map((line, index) => {
    const next = parsed[index + 1];
    const estimated = line.start + Math.max(2, Math.round(line.text.length / 15));
    return {
      start: line.start,
      end: next ? next.start : Math.max(estimated, totalSeconds || 0),
      text: line.text,
      speaker: line.speaker,
    };
  });
}

export async function transcribeWithGemini(
  filePath: string,
  options?: TranscriptionProviderOptions,
): Promise<TranscriptionProviderResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY no está configurada");
  }

  const bytes = fs.statSync(filePath).size;
  if (bytes > GEMINI_INLINE_MAX_BYTES) {
    throw new Error(
      `El audio pesa ${(bytes / 1048576).toFixed(1)} MB y supera el límite en línea de Gemini ` +
      `(${(GEMINI_INLINE_MAX_BYTES / 1048576).toFixed(0)} MB). Debería haberse troceado antes.`,
    );
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: getAiModels().geminiModel,
    generationConfig: { temperature: 0 },
  });

  const result = await withTimeout(
    model.generateContent([
      { text: buildDiarizationPrompt(options?.context, options?.dictionaryTerms) },
      {
        inlineData: {
          mimeType: mimeTypeFor(filePath),
          data: fs.readFileSync(filePath).toString("base64"),
        },
      },
    ]),
    resolveProviderTimeoutMs(),
    `Gemini transcripción (${getAiModels().geminiModel})`,
  );

  const raw = result.response.text().trim();
  // Un audio sin voz produce una transcripción vacía, y eso NO es un error: es una grabación muda.
  // Devolver vacío deja que el pipeline siga; lanzar aquí convertiría un silencio en un fallo.
  if (!raw) {
    console.warn("[geminiTranscription] Gemini no devolvió texto (¿audio sin voz?).");
    return { text: "", segments: [], durationSeconds: 0 };
  }

  // Sin tope artificial de tokens: si el modelo se cortase, se detecta por el fin de la respuesta.
  const finishReason = (result.response.candidates?.[0] as { finishReason?: string } | undefined)
    ?.finishReason;
  if (finishReason && finishReason !== "STOP" && finishReason !== "MAX_TOKENS") {
    console.warn(`[geminiTranscription] finishReason inesperado: ${finishReason}`);
  }

  const durationSeconds = extractLastTimestamp(raw);
  const segments = parseDiarizedTranscript(raw, durationSeconds);

  return {
    text: segments.map((s) => `${s.speaker} [${formatTimestamp(s.start)}]: ${s.text}`).join("\n") || raw,
    segments,
    durationSeconds,
  };
}

/** Último `[MM:SS]` del texto, para conocer la cobertura real de la transcripción. */
export function extractLastTimestamp(raw: string): number {
  let last = 0;
  for (const match of raw.matchAll(/\[(\d{1,3}):(\d{2})\]/g)) {
    last = Math.max(last, Number(match[1]) * 60 + Number(match[2]));
  }
  return last;
}

function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}
