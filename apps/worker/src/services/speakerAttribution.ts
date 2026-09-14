/**
 * Atribución de hablantes por LLM para transcripciones sin diarización
 * (Groq Whisper no diariza). Port del patrón de `diarize_llm.py` de
 * clean_transcriptions: [MM:SS] + etiqueta de hablante por línea, por chunks,
 * con fallback silencioso (nunca rompe el pipeline).
 */
import Groq from "groq-sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { TranscriptionSegment } from "@/integrations/ai/transcription/TranscriptionProvider";
import { getAiModels, resolveTextOutputBudget } from "@/services/aiModels";

const MAX_CHARS_PER_CHUNK = 25000;
const MAX_SEGMENT_CHARS = 400;

export function isSpeakerAttributionEnabled(): boolean {
  return process.env.SPEAKER_ATTRIBUTION_ENABLED !== "false";
}

export interface AttributedLine {
  speaker: string;
  start: number;
  end: number;
  text: string;
}

/** Convierte segmentos a líneas `[MM:SS] texto` para el prompt. */
export function segmentsToLines(segments: TranscriptionSegment[]): string[] {
  return segments.map((s) => {
    const mins = Math.floor(s.start / 60);
    const secs = Math.floor(s.start % 60);
    const ts = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    return `[${ts}] ${s.text.trim()}`;
  });
}

/** Parte las líneas en chunks que respetan el límite de caracteres. */
export function chunkLines(lines: string[], maxChars = MAX_CHARS_PER_CHUNK): string[][] {
  return chunkLineIndexes(lines, maxChars).map((indexes) => indexes.map((i) => lines[i]));
}

/**
 * Igual que `chunkLines` pero devolviendo los índices: es lo que permite mapear cada chunk de vuelta
 * a sus segmentos originales y no perder contenido cuando un chunk no se puede atribuir.
 */
export function chunkLineIndexes(lines: string[], maxChars = MAX_CHARS_PER_CHUNK): number[][] {
  const chunks: number[][] = [];
  let current: number[] = [];
  let currentLength = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const length = lines[i].length + 1;
    if (currentLength + length > maxChars && current.length > 0) {
      chunks.push(current);
      current = [];
      currentLength = 0;
    }
    current.push(i);
    currentLength += length;
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

/**
 * ¿La atribución de un chunk perdió contenido?
 *
 * `truncated` es la señal dura (`finish_reason === "length"`: el modelo agotó el presupuesto de
 * salida). El ratio de caracteres es la red de seguridad para una pérdida parcial que no llegue a
 * truncar. Mismo umbral del 70 % que ya usa la guarda del refiner, por coherencia.
 */
export function isAttributionLossy(
  inputChars: number,
  outputChars: number,
  truncated: boolean,
  minRatio = 0.7,
): boolean {
  if (truncated) return true;
  if (inputChars <= 0) return outputChars <= 0;
  return outputChars / inputChars < minRatio;
}

/** Tolerancia al emparejar un segmento con la línea atribuida más cercana. */
export const ATTRIBUTION_MATCH_TOLERANCE_SECONDS = 3;

/** Hablante vigente en un instante: el de la última línea atribuida que ya ha empezado. */
export function speakerAt(
  timeline: ReadonlyArray<AttributedLine>,
  timeSeconds: number,
  toleranceSeconds = ATTRIBUTION_MATCH_TOLERANCE_SECONDS,
): string | undefined {
  let speaker: string | undefined;

  for (const line of timeline) {
    if (line.start <= timeSeconds + toleranceSeconds) {
      speaker = line.speaker;
      continue;
    }
    break;
  }

  return speaker;
}

/**
 * Aplica una atribución a los segmentos de un chunk **sin descartar ningún segmento**.
 *
 * La versión anterior emparejaba por timestamp y tiraba los segmentos que no casaban: si el modelo
 * fusionaba líneas o se truncaba, ese contenido desaparecía del transcript. Aquí el segmento siempre
 * se conserva; lo único que puede faltar es la etiqueta de hablante.
 */
export function applyAttributionToChunk<T extends TranscriptionSegment>(
  chunkSegments: ReadonlyArray<T>,
  timeline: ReadonlyArray<AttributedLine>,
): T[] {
  if (!timeline.length) {
    return [...chunkSegments];
  }

  const ordered = [...timeline].sort((a, b) => a.start - b.start);

  return chunkSegments.map((segment) => {
    const speaker = speakerAt(ordered, segment.start);
    return speaker ? { ...segment, speaker } : { ...segment };
  });
}

/** Prompt de atribución (mismo estilo que diarize_llm.py). */
export function buildAttributionPrompt(chunk: string, partIndex: number, partCount: number): string {
  return `Eres un transcriptor profesional de reuniones. Tu tarea es ETIQUETAR quién habla en una transcripción automática (Whisper) que sólo tiene timestamps [MM:SS]. No es una tarea de redacción ni de resumen: añades una etiqueta delante de cada línea y nada más.

REGLAS:
1. Reemite TODAS las líneas, en el MISMO orden y con el MISMO número de líneas que la entrada. No fusiones líneas, no omitas ninguna, no añadas ninguna.
2. Conserva el timestamp [MM:SS] exacto y el texto de cada línea tal como viene. No reescribas, no corrijas, no acortes y no "limpies" muletillas: no es tu trabajo y hacerlo destruye contenido de la reunión.
3. Añade delante de cada línea el hablante: "Participante 1", "Participante 2", ... (máximo 6). Usa el mismo número para la misma voz. Si el contexto revela un nombre (ej. "hola, soy Marta"), úsalo como etiqueta.
4. Si una línea es incomprensible, deja su texto tal cual.
5. Formato de salida EXACTO por línea (sin títulos, sin resumen, sin comentarios):
Participante 1 [MM:SS]: texto
Participante 2 [MM:SS]: texto

TRANSCRIPCIÓN (parte ${partIndex + 1} de ${partCount}):
${chunk}`;
}

const ATTRIBUTED_LINE_RE = /^(.+?)\s*\[(\d{1,2}):(\d{2})\]\s*:\s*(.+)$/;
const PLAIN_TIMESTAMP_RE = /^\[(\d{1,2}):(\d{2})\]\s*(.+)$/;

/**
 * Parsea la respuesta del LLM de vuelta a líneas con hablante.
 * Devuelve [] si no encuentra ninguna línea con hablante (fallback silencioso).
 */
export function parseAttributedLines(text: string): AttributedLine[] {
  const lines: AttributedLine[] = [];

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const attributed = line.match(ATTRIBUTED_LINE_RE);
    if (attributed) {
      const speaker = attributed[1]?.trim() || "Participante 1";
      const start = Number(attributed[2]) * 60 + Number(attributed[3]);
      lines.push({
        speaker,
        start,
        end: start + 5,
        text: attributed[4]?.trim() || "",
      });
      continue;
    }

    const plain = line.match(PLAIN_TIMESTAMP_RE);
    if (plain) {
      const start = Number(plain[1]) * 60 + Number(plain[2]);
      lines.push({
        speaker: "Participante 1",
        start,
        end: start + 5,
        text: plain[3]?.trim() || "",
      });
    }
  }

  return lines;
}

/**
 * Reconstruye segmentos con speaker desde líneas atribuidas, emparejando por
 * timestamp con los segmentos originales (preserva duraciones reales).
 */
export function attributedLinesToSegments(
  attributed: AttributedLine[],
  original: TranscriptionSegment[],
): TranscriptionSegment[] {
  if (!attributed.length) {
    return original;
  }

  // Índice por timestamp aproximado (tolerancia ±3s) para reutilizar duraciones.
  const byStart = new Map<number, TranscriptionSegment[]>();
  for (const seg of original) {
    const key = Math.round(seg.start);
    const bucket = byStart.get(key) || [];
    bucket.push(seg);
    byStart.set(key, bucket);
  }

  const used = new Set<number>();
  const result: TranscriptionSegment[] = [];

  for (const line of attributed) {
    let best: TranscriptionSegment | undefined;
    for (const seg of original) {
      if (used.has(seg.start)) continue;
      if (Math.abs(seg.start - line.start) <= 3) {
        best = seg;
        break;
      }
    }

    if (best) {
      used.add(best.start);
      result.push({
        start: best.start,
        end: best.end,
        text: line.text,
        speaker: line.speaker,
      });
    } else {
      result.push({
        start: line.start,
        end: line.end,
        text: line.text,
        speaker: line.speaker,
      });
    }
  }

  // Si no emparejamos nada (p.ej. el LLM cambió los timestamps), devolvemos
  // los segmentos atribuidos tal cual — siguen teniendo hablante.
  return result.length > 0 ? result : attributed.map((l) => ({
    start: l.start,
    end: l.end,
    text: l.text,
    speaker: l.speaker,
  }));
}

/** Resultado de atribuir un chunk, con la señal de si el modelo agotó su presupuesto de salida. */
export interface ChunkAttribution {
  text: string;
  truncated: boolean;
}

async function attributeWithGroq(chunks: string[][]): Promise<ChunkAttribution[]> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY no está configurada");

  const groq = new Groq({ apiKey });
  const outputs: ChunkAttribution[] = [];

  for (let i = 0; i < chunks.length; i += 1) {
    const chunkText = chunks[i].join("\n");
    const prompt = buildAttributionPrompt(chunkText, i, chunks.length);
    const result = await groq.chat.completions.create({
      model: getAiModels().textModel,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      // La atribución reemite el diálogo con la etiqueta de hablante, así que la salida es del
      // orden de la entrada: un presupuesto fijo truncaba los fragmentos grandes.
      max_tokens: resolveTextOutputBudget(chunkText.length),
    });
    const text = result.choices[0]?.message?.content?.trim() || "";
    if (!text) throw new Error("Groq devolvió una respuesta vacía en atribución");
    outputs.push({ text, truncated: result.choices[0]?.finish_reason === "length" });
  }

  return outputs;
}

async function attributeWithGemini(chunks: string[][]): Promise<ChunkAttribution[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY no está configurada");

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: getAiModels().geminiModel,
    generationConfig: { temperature: 0.2 },
  });
  const outputs: ChunkAttribution[] = [];

  for (let i = 0; i < chunks.length; i += 1) {
    const chunkText = chunks[i].join("\n");
    const prompt = buildAttributionPrompt(chunkText, i, chunks.length);
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    if (!text) throw new Error("Gemini devolvió una respuesta vacía en atribución");
    const finishReason = (result.response.candidates?.[0] as { finishReason?: string } | undefined)
      ?.finishReason;
    outputs.push({ text, truncated: finishReason === "MAX_TOKENS" });
  }

  return outputs;
}

/**
 * Atribuye hablantes a segmentos sin speaker vía LLM (Groq → Gemini fallback).
 *
 * Nunca pierde contenido: si un chunk se trunca o adelgaza demasiado, sus segmentos se conservan sin
 * hablante en vez de descartarse. Antes, un chunk truncado hacía desaparecer del transcript todo lo
 * que el modelo no hubiera llegado a reemitir — medido: 4 minutos de una reunión de 53.
 *
 * Lanza sólo si NINGÚN chunk se pudo atribuir: el caller degrada entonces al formato sin hablantes.
 */
export async function attributeSpeakersToSegments(
  segments: TranscriptionSegment[],
): Promise<TranscriptionSegment[]> {
  const lines = segmentsToLines(segments);
  if (!lines.length) {
    return segments;
  }

  const lineIndexes = chunkLineIndexes(lines);
  const prompts = lineIndexes.map((indexes) => indexes.map((i) => lines[i]));

  let outputs: ChunkAttribution[] | null = null;

  if (process.env.GROQ_API_KEY) {
    try {
      outputs = await attributeWithGroq(prompts);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[speakerAttribution] Groq falló (${msg}), fallback a Gemini...`);
    }
  }

  if (!outputs && process.env.GEMINI_API_KEY) {
    outputs = await attributeWithGemini(prompts);
  }

  if (!outputs) {
    throw new Error("No hay API key configurada para atribución de hablantes (GROQ_API_KEY o GEMINI_API_KEY)");
  }

  const result: TranscriptionSegment[] = [];
  let lossyChunks = 0;

  for (let c = 0; c < lineIndexes.length; c += 1) {
    const chunkSegments = lineIndexes[c].map((i) => segments[i]);
    const inputChars = prompts[c].join("\n").length;
    const outcome = outputs[c];
    const parsed = outcome ? parseAttributedLines(outcome.text) : [];
    const parsedChars = parsed.reduce((sum, line) => sum + line.text.length, 0);

    if (!outcome || isAttributionLossy(inputChars, parsedChars, outcome.truncated)) {
      lossyChunks += 1;
      console.warn(
        `[speakerAttribution] Chunk ${c + 1}/${lineIndexes.length} descartado ` +
        `(truncado=${outcome?.truncated ?? "sin respuesta"}, ${inputChars}->${parsedChars} chars): ` +
        `se conservan sus segmentos sin hablante para no perder contenido.`,
      );
      result.push(...chunkSegments);
      continue;
    }

    result.push(...applyAttributionToChunk(chunkSegments, parsed));
  }

  if (lossyChunks === lineIndexes.length) {
    throw new Error("Ningún chunk se pudo atribuir sin pérdida de contenido");
  }

  return result;
}

/** Atribución con límite de texto por segmento (protección de prompts enormes). */
export function capSegmentText(segments: TranscriptionSegment[], maxChars = MAX_SEGMENT_CHARS): TranscriptionSegment[] {
  return segments.map((s) =>
    s.text.length > maxChars ? { ...s, text: `${s.text.slice(0, maxChars)}…` } : s,
  );
}
