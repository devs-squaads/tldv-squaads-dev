import type {
  TranscriptionProvider,
  TranscriptionProviderOptions,
} from "@/integrations/ai/transcription/TranscriptionProvider";
import {
  GEMINI_INLINE_MAX_BYTES,
  transcribeWithGemini,
} from "@/services/geminiTranscription";

/**
 * Transcripción con Gemini: audio → segmentos con hablante, en una sola petición.
 *
 * Declara su propio límite de entrada (`maxInputBytes`) para que el troceo de
 * `transcribeRecording` se ajuste al proveedor en vez de a un valor cableado.
 */
export class GeminiTranscriptionProvider implements TranscriptionProvider {
  readonly name = "gemini";
  readonly maxInputBytes = GEMINI_INLINE_MAX_BYTES;

  async transcribe(filePath: string, options?: TranscriptionProviderOptions): Promise<string> {
    const result = await transcribeWithGemini(filePath, options);
    return result.text;
  }

  async transcribeDetailed(filePath: string, options?: TranscriptionProviderOptions) {
    return transcribeWithGemini(filePath, options);
  }
}
