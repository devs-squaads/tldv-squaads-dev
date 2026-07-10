import { DeepgramClient, type ListenV1Response } from "@deepgram/sdk";
import fs from "fs";
import type { TranscriptionProviderOptions } from "@/integrations/ai/transcription/TranscriptionProvider";

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

/**
 * Transcribes audio file using Deepgram SDK v5+
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

  try {
    const fileBuffer = fs.readFileSync(filePath);

    // Using listen.v1.media.transcribeFile
    const response = await deepgram.listen.v1.media.transcribeFile(
      fileBuffer,
      {
        model,
        smart_format: true,
        language: "es",
        diarize: true,
        ...buildTermOptions(model, options),
      }
    );

    // Extract the transcript: SDK v5 returns it under results in ListenV1Response
    // We cast to any or use ListenV1Response and optional chaining for safety
    const transcript = (response as ListenV1Response).results?.channels?.[0]?.alternatives?.[0]?.transcript || "";
    
    return transcript;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Error transcribing with Deepgram:", err);
    throw new Error(`Failed to transcribe audio: ${message}`);
  }
}
