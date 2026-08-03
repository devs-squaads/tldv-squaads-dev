/**
 * Atribución de hablantes por LLM para transcripciones sin diarización
 * (Groq Whisper no diariza). Port del patrón de `diarize_llm.py` de
 * clean_transcriptions: [MM:SS] + etiqueta de hablante por línea, por chunks,
 * con fallback silencioso (nunca rompe el pipeline).
 */
import Groq from "groq-sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { TranscriptionSegment } from "@/integrations/ai/transcription/TranscriptionProvider";

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
  const chunks: string[][] = [];
  let current: string[] = [];
  let currentLength = 0;

  for (const line of lines) {
    if (currentLength + line.length + 1 > maxChars && current.length > 0) {
      chunks.push(current);
      current = [];
      currentLength = 0;
    }
    current.push(line);
    currentLength += line.length + 1;
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

/** Prompt de atribución (mismo estilo que diarize_llm.py). */
export function buildAttributionPrompt(chunk: string, partIndex: number, partCount: number): string {
  return `Eres un transcriptor profesional de reuniones. Tu tarea: reconstruir el DIÁLOGO con hablantes a partir de una transcripción automática (Whisper) que tiene SOLO timestamps [MM:SS], sin nombres de hablante.

REGLAS:
1. Conserva el timestamp [MM:SS] exacto de cada línea.
2. Atribuye un hablante a cada línea: "Participante 1", "Participante 2", ... (máximo 6). Usa el mismo número para la misma voz. Si puedes inferir un nombre del contexto de la conversación (ej. "hola, soy Marta"), úsalo como etiqueta.
3. NO resumas, NO elimines contenido. Limpia solo muletillas ("eeeeh", "o sea", "vale" repetido) y tartamudeos.
4. Preserva el tono coloquial.
5. Si una línea es incomprensible, déjala como "..." y añade "[ininteligible]".
6. Formato de salida EXACTO por línea (sin títulos ni resumen):
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

async function attributeWithGroq(
  chunks: string[][],
): Promise<string[]> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY no está configurada");

  const groq = new Groq({ apiKey });
  const outputs: string[] = [];

  for (let i = 0; i < chunks.length; i += 1) {
    const prompt = buildAttributionPrompt(chunks[i].join("\n"), i, chunks.length);
    const result = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 8192,
    });
    const text = result.choices[0]?.message?.content?.trim() || "";
    if (!text) throw new Error("Groq devolvió una respuesta vacía en atribución");
    outputs.push(text);
  }

  return outputs;
}

async function attributeWithGemini(
  chunks: string[][],
): Promise<string[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY no está configurada");

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-3.1-flash-lite",
    generationConfig: { temperature: 0.2 },
  });
  const outputs: string[] = [];

  for (let i = 0; i < chunks.length; i += 1) {
    const prompt = buildAttributionPrompt(chunks[i].join("\n"), i, chunks.length);
    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    if (!text) throw new Error("Gemini devolvió una respuesta vacía en atribución");
    outputs.push(text);
  }

  return outputs;
}

/**
 * Atribuye hablantes a segmentos sin speaker vía LLM (Groq → Gemini fallback).
 * Lanza si falla: el caller decide degradar al formato sin hablantes.
 */
export async function attributeSpeakersToSegments(
  segments: TranscriptionSegment[],
): Promise<TranscriptionSegment[]> {
  const lines = segmentsToLines(segments);
  if (!lines.length) {
    return segments;
  }

  const chunks = chunkLines(lines);

  let outputs: string[] | null = null;

  if (process.env.GROQ_API_KEY) {
    try {
      outputs = await attributeWithGroq(chunks);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[speakerAttribution] Groq falló (${msg}), fallback a Gemini...`);
    }
  }

  if (!outputs && process.env.GEMINI_API_KEY) {
    outputs = await attributeWithGemini(chunks);
  }

  if (!outputs) {
    throw new Error("No hay API key configurada para atribución de hablantes (GROQ_API_KEY o GEMINI_API_KEY)");
  }

  const attributed = outputs.flatMap((out) => parseAttributedLines(out));
  return attributedLinesToSegments(attributed, segments);
}

/** Atribución con límite de texto por segmento (protección de prompts enormes). */
export function capSegmentText(segments: TranscriptionSegment[], maxChars = MAX_SEGMENT_CHARS): TranscriptionSegment[] {
  return segments.map((s) =>
    s.text.length > maxChars ? { ...s, text: `${s.text.slice(0, maxChars)}…` } : s,
  );
}
