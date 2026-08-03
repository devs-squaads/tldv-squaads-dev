import { DeepgramClient, type ListenV1Response } from "@deepgram/sdk";
import fs from "fs";
import type {
  TranscriptionProviderOptions,
  TranscriptionSegment,
} from "@/integrations/ai/transcription/TranscriptionProvider";

function getDeepgramModel(): string {
  return process.env.DEEPGRAM_MODEL || "nova-2";
}

function buildTermOptions(model: string, options?: TranscriptionProviderOptions) {
  const dictionaryTerms = options?.dictionaryTerms?.filter(Boolean) || [];
  if (!dictionaryTerms.length) {
    return {};
  }

  if (model.toLowerCase().startsWith("nova-3")) {
    return { keyterm: dictionaryTerms };
  }

  return { keywords: dictionaryTerms };
}

export interface DeepgramWord {
  word?: string;
  start?: number;
  end?: number;
  speaker?: number;
}

/**
 * Transcribe audio file using Deepgram SDK v5+
 * Uses Nova-2 model and returns Spanish transcript by default.
 */
export async function transcribeAudio(
  filePath: string,
  options?: TranscriptionProviderOptions,
): Promise<string> {
  const deepgramApiKey = process.env.DEEPGRAM_API_KEY;

  if (!deepgramApiKey) {
    throw new Error("DEEPGRAM_API_KEY is missing in environment variables.");
  }

  // SDK v5+ requires an options object
  const deepgram = new DeepgramClient({ apiKey: deepgramApiKey });
  const model = getDeepgramModel();

  const fileBuffer = fs.readFileSync(filePath);

  const response = await deepgram.listen.v1.media.transcribeFile(
    fileBuffer,
    {
      model,
      smart_format: true,
      language: "es",
      diarize: true,
      ...buildTermOptions(model, options),
    },
  );

  const transcript = (response as ListenV1Response).results?.channels?.[0]?.alternatives?.[0]?.transcript || "";

  return transcript;
}

/** Aisla el array de palabras del response (defensivo ante cambios del SDK). */
export function extractWords(response: ListenV1Response): DeepgramWord[] {
  const words = response?.results?.channels?.[0]?.alternatives?.[0]?.words;
  return Array.isArray(words) ? (words as DeepgramWord[]) : [];
}

/**
 * Agrupa palabras consecutivas del mismo hablante en turnos (segmentos).
 * Cambio de speaker o hueco > 2s inicia un turno nuevo. Etiqueta "Participante N".
 * Devuelve [] si no hay palabras con speaker (degradación a texto plano).
 */
export function groupWordsIntoTurns(
  words: DeepgramWord[],
  maxGapSeconds = 2,
): TranscriptionSegment[] {
  const withSpeaker = words.filter((w) => typeof w.speaker === "number");
  if (!withSpeaker.length) {
    return [];
  }

  const turns: TranscriptionSegment[] = [];
  let current: DeepgramWord[] = [];
  let currentSpeaker = -1;

  const flush = () => {
    if (!current.length) return;
    const first = current[0];
    const last = current[current.length - 1];
    const text = current
      .map((w) => w.word || "")
      .filter(Boolean)
      .join(" ")
      .replace(/\s+([.,;:!?])/g, "$1")
      .trim();

    if (text) {
      turns.push({
        start: Number(first.start) || 0,
        end: Number(last.end) || (Number(first.start) || 0) + 1,
        text,
        speaker: `Participante ${currentSpeaker + 1}`,
      });
    }
    current = [];
  };

  for (const word of withSpeaker) {
    const speaker = Number(word.speaker);

    if (current.length > 0 && (speaker !== currentSpeaker ||
        (Number(word.start) - Number(current[current.length - 1].end) > maxGapSeconds))) {
      flush();
    }

    currentSpeaker = speaker;
    current.push(word);
  }

  flush();

  return turns;
}

/**
 * Transcribe audio/video usando Deepgram SDK v5+ con diarización y timestamps.
 * Modelo: Nova-2 por defecto. Devuelve texto + segmentos con hablante.
 */
export async function transcribeDetailed(
  filePath: string,
  options?: TranscriptionProviderOptions,
): Promise<{ text: string; segments: TranscriptionSegment[]; duration: number }> {
  const deepgramApiKey = process.env.DEEPGRAM_API_KEY;

  if (!deepgramApiKey) {
    throw new Error("DEEPGRAM_API_KEY is missing in environment variables.");
  }

  const deepgram = new DeepgramClient({ apiKey: deepgramApiKey });
  const model = getDeepgramModel();

  const fileBuffer = fs.readFileSync(filePath);

  const response = await deepgram.listen.v1.media.transcribeFile(
    fileBuffer,
    {
      model,
      smart_format: true,
      language: "es",
      diarize: true,
      punctuate: true,
      ...buildTermOptions(model, options),
    },
  );

  const alternative = (response as ListenV1Response)?.results?.channels?.[0]?.alternatives?.[0];
  const transcript = alternative?.transcript || "";

  const words = extractWords(response as ListenV1Response);
  const segments = groupWordsIntoTurns(words);

  const lastEnd = segments.length > 0 ? segments[segments.length - 1].end : 0;
  const duration = lastEnd || Number((response as ListenV1Response)?.metadata?.duration) || 0;

  return { text: transcript, segments, duration };
}
