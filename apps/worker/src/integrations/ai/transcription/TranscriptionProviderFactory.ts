import type { TranscriptionProvider } from "@/integrations/ai/transcription/TranscriptionProvider";
import { DeepgramTranscriptionProvider } from "@/integrations/ai/transcription/providers/DeepgramTranscriptionProvider";
import { GroqTranscriptionProvider } from "@/integrations/ai/transcription/providers/GroqTranscriptionProvider";

const TRANSCRIPTION_PROVIDER_BUILDERS: Record<string, () => TranscriptionProvider> = {
  groq: () => new GroqTranscriptionProvider(),
  deepgram: () => new DeepgramTranscriptionProvider(),
};

function getAutoProviderName(): string | null {
  if (process.env.GROQ_API_KEY) return "groq";
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
