import Groq from "groq-sdk";
import fs from "fs";
import type { TranscriptionProviderOptions } from "@/integrations/ai/transcription/TranscriptionProvider";

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface TimestampedTranscription {
  text: string;
  segments: TranscriptSegment[];
  duration: number;
}

const MAX_PROMPT_LENGTH = 1200;

function buildPrompt(options?: TranscriptionProviderOptions): string | undefined {
  const context = options?.context?.trim();
  const dictionaryTerms = options?.dictionaryTerms?.filter(Boolean) || [];

  if (!context && !dictionaryTerms.length) {
    return undefined;
  }

  const sections: string[] = [];

  if (context) {
    sections.push(`Contexto relevante de la reunión:\n${context}`);
  }

  if (dictionaryTerms.length) {
    sections.push(
      `Términos y nombres a transcribir con especial cuidado:\n${dictionaryTerms.join(", ")}`
    );
  }

  sections.push("Mantén la transcripción en español y prioriza estas referencias si aparecen en el audio.");

  const prompt = sections.join("\n\n").trim();
  if (!prompt) {
    return undefined;
  }

  return prompt.slice(0, MAX_PROMPT_LENGTH);
}

/**
 * Transcribes audio/video using Groq's Whisper API (free tier).
 * Model: whisper-large-v3 — supports Spanish and multilingual.
 * Returns full text + timestamped segments for chapter generation.
 */
export async function transcribeAudio(
  filePath: string,
  options?: TranscriptionProviderOptions,
): Promise<string> {
  const result = await transcribeAudioWithTimestamps(filePath, options);
  return result.text;
}

export async function transcribeAudioWithTimestamps(
  filePath: string,
  options?: TranscriptionProviderOptions,
): Promise<TimestampedTranscription> {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    throw new Error("GROQ_API_KEY is missing in environment variables.");
  }

  const groq = new Groq({ apiKey });
  const prompt = buildPrompt(options);

  try {
    const transcription = await groq.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: "whisper-large-v3",
      language: "es",
      ...(prompt ? { prompt } : {}),
      response_format: "verbose_json",
      timestamp_granularities: ["segment"],
    });

    const raw = transcription as unknown as Record<string, unknown>;
    const rawSegments = (raw.segments as Array<Record<string, unknown>>) || [];

    const segments: TranscriptSegment[] = rawSegments.map((s) => ({
      start: Number(s.start) || 0,
      end: Number(s.end) || 0,
      text: String(s.text || "").trim(),
    }));

    const duration = segments.length > 0
      ? segments[segments.length - 1].end
      : Number(raw.duration) || 0;

    return {
      text: String(raw.text || ""),
      segments,
      duration,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Error transcribing with Groq Whisper:", err);
    throw new Error(`Failed to transcribe audio: ${message}`);
  }
}
