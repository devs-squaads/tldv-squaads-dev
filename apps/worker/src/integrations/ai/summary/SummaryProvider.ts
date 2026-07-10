import type { SummaryResult } from "@meeting-bot/shared/integrations/ai/summary/types";

export interface SummaryProviderOptions {
  context?: string;
}

export interface SummaryProvider {
  readonly name: string;
  summarize(transcript: string, options?: SummaryProviderOptions): Promise<SummaryResult>;
}
