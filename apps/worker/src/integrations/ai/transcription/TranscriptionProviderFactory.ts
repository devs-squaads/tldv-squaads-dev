import type { TranscriptionProvider } from "@/integrations/ai/transcription/TranscriptionProvider";
import { DeepgramTranscriptionProvider } from "@/integrations/ai/transcription/providers/DeepgramTranscriptionProvider";
import { GeminiTranscriptionProvider } from "@/integrations/ai/transcription/providers/GeminiTranscriptionProvider";

/**
 * Proveedores de transcripción disponibles.
 *
 * Gemini es el preferido por dos motivos medidos sobre una reunión real de 53,5 min: transcribe en 63,5 s
 * (frente a 15 s de ASR + ~110 s de atribución de hablantes por LLM) y **diariza de forma acústica**, así
 * que los hablantes se distinguen por voz y no se infieren del texto.
 */
const TRANSCRIPTION_PROVIDER_BUILDERS: Record<string, () => TranscriptionProvider> = {
  gemini: () => new GeminiTranscriptionProvider(),
  deepgram: () => new DeepgramTranscriptionProvider(),
};

function getAutoProviderName(): string | null {
  if (process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.DEEPGRAM_API_KEY) return "deepgram";
  return null;
}

export class TranscriptionProviderFactory {
  static isConfigured(): boolean {
    return Boolean(process.env.TRANSCRIPTION_PROVIDER || getAutoProviderName());
  }

  static getProvider(): TranscriptionProvider {
    const configuredName = process.env.TRANSCRIPTION_PROVIDER?.toLowerCase();
    const providerName = configuredName || getAutoProviderName();

    if (!providerName) {
      throw new Error("No transcription provider configured. Set TRANSCRIPTION_PROVIDER or provider API keys.");
    }

    const build = TRANSCRIPTION_PROVIDER_BUILDERS[providerName];
    if (!build) {
      const supported = Object.keys(TRANSCRIPTION_PROVIDER_BUILDERS).join(", ");
      throw new Error(`Unsupported transcription provider "${providerName}". Supported: ${supported}`);
    }

    return build();
  }
}
