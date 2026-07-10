import type { SummaryProvider, SummaryProviderOptions } from "@/integrations/ai/summary/SummaryProvider";
import type { SummaryResult } from "@meeting-bot/shared/integrations/ai/summary/types";
import { generateSummary } from "@/services/openai";

export class OpenAISummaryProvider implements SummaryProvider {
  readonly name = "openai";

  async summarize(transcript: string, options?: SummaryProviderOptions): Promise<SummaryResult> {
    const result = await generateSummary(transcript, undefined, options?.context);
    return {
      summary: result.summary,
      actionItems: result.actionItems,
      keyMoments: [],
    };
  }
}
