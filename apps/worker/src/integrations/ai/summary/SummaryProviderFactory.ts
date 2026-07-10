import type { SummaryProvider } from "@/integrations/ai/summary/SummaryProvider";
import { GeminiSummaryProvider } from "@/integrations/ai/summary/providers/GeminiSummaryProvider";
import { OpenAISummaryProvider } from "@/integrations/ai/summary/providers/OpenAISummaryProvider";

const SUMMARY_PROVIDER_BUILDERS: Record<string, () => SummaryProvider> = {
  gemini: () => new GeminiSummaryProvider(),
  openai: () => new OpenAISummaryProvider(),
};

function getAutoProviderName(): string | null {
  if (process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY) return "gemini";
  if (process.env.OPENAI_API_KEY) return "openai";
  return null;
}

export class SummaryProviderFactory {
  static isConfigured(): boolean {
    return Boolean(process.env.SUMMARY_PROVIDER || getAutoProviderName());
  }

  static getProvider(): SummaryProvider {
    const configuredName = process.env.SUMMARY_PROVIDER?.toLowerCase();
    const providerName = configuredName || getAutoProviderName();

    if (!providerName) {
      throw new Error("No summary provider configured. Set SUMMARY_PROVIDER or provider API keys.");
    }

    const build = SUMMARY_PROVIDER_BUILDERS[providerName];
    if (!build) {
      const supported = Object.keys(SUMMARY_PROVIDER_BUILDERS).join(", ");
      throw new Error(`Unsupported summary provider "${providerName}". Supported: ${supported}`);
    }

    return build();
  }
}
