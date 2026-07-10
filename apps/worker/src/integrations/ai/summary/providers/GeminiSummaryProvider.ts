import type { SummaryProvider, SummaryProviderOptions } from "@/integrations/ai/summary/SummaryProvider";
import type { SummaryResult } from "@meeting-bot/shared/integrations/ai/summary/types";
import { generateSummary } from "@/services/gemini";

export class GeminiSummaryProvider implements SummaryProvider {
  readonly name = "gemini";

  async summarize(transcript: string, options?: SummaryProviderOptions): Promise<SummaryResult> {
    return generateSummary(transcript, undefined, options?.context);
  }
}
