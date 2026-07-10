import type { SummaryResult } from "@meeting-bot/shared/integrations/ai/summary/types";
import { SummaryProviderFactory } from "@/integrations/ai/summary/SummaryProviderFactory";
import type {
  TranscriptionProviderOptions,
  TranscriptionProviderResult,
  TranscriptionSegment,
} from "@/integrations/ai/transcription/TranscriptionProvider";
import { TranscriptionProviderFactory } from "@/integrations/ai/transcription/TranscriptionProviderFactory";
import { formatTimestampedTranscript, refineTranscriptWithGemini } from "@/services/gemini";
import {
  getTranscriptionSettings,
  type TranscriptionSettings,
} from "@meeting-bot/shared/services/transcriptionSettings";

export function hasTranscriptionProvider(): boolean {
  return TranscriptionProviderFactory.isConfigured();
}

export function hasSummaryProvider(): boolean {
  return SummaryProviderFactory.isConfigured();
}

export function serializeTranscript(
  segments: TranscriptionSegment[],
  fallbackTranscript: string,
): string {
  if (!segments.length) {
    return fallbackTranscript;
  }
  return formatTimestampedTranscript(segments);
}

export function withSummaryDuration(
  summary: SummaryResult,
  transcription: TranscriptionProviderResult,
): SummaryResult {
  if (!transcription.durationSeconds) {
    return summary;
  }
  return {
    ...summary,
    durationSeconds: summary.durationSeconds ?? transcription.durationSeconds,
  };
}

export async function resolveTranscriptionOptions(): Promise<TranscriptionProviderOptions> {
  const settings = await getTranscriptionSettings();

  return {
    context: settings.context || undefined,
    dictionaryTerms: settings.dictionaryTerms,
  };
}

export async function loadGlobalTranscriptionSettings(): Promise<TranscriptionSettings> {
  return getTranscriptionSettings();
}

/**
 * Applies context/dictionary-based refinement over the timestamped transcript.
 * Safe: if the refiner fails or no context is configured, returns the input unchanged.
 */
export async function refineTranscriptionResult(
  transcription: TranscriptionProviderResult,
  settings: TranscriptionSettings,
): Promise<TranscriptionProviderResult> {
  const context = settings.context?.trim();
  if (!context) {
    return transcription;
  }

  const rawInput = serializeTranscript(transcription.segments, transcription.text);
  if (!rawInput.trim()) {
    return transcription;
  }

  try {
    const refinedText = await refineTranscriptWithGemini(
      rawInput,
      context,
      settings.dictionaryTerms,
    );

    if (!refinedText || refinedText === rawInput) {
      return {
        ...transcription,
        text: rawInput,
      };
    }

    // Validation: ensure refiner preserves most [MM:SS] markers.
    const TIMESTAMP_RE = /\[\d{1,2}:\d{2}\]/g;
    const originalTsCount = (rawInput.match(TIMESTAMP_RE) || []).length;
    const refinedTsCount = (refinedText.match(TIMESTAMP_RE) || []).length;

    if (originalTsCount > 0 && refinedTsCount / originalTsCount < 0.7) {
      console.warn(
        `[refineTranscriptionResult] Refiner dropped timestamps (${originalTsCount} -> ${refinedTsCount}), keeping raw timestamped text`,
      );
      return {
        ...transcription,
        text: rawInput,
      };
    }

    return {
      ...transcription,
      text: refinedText,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[refineTranscriptionResult] Refiner failed, keeping raw transcript: ${message}`);
    return {
      ...transcription,
      text: rawInput,
    };
  }
}

export async function transcribeRecording(
  filePath: string,
  options?: TranscriptionProviderOptions,
): Promise<TranscriptionProviderResult> {
  const provider = TranscriptionProviderFactory.getProvider();
  if (provider.transcribeDetailed) {
    return provider.transcribeDetailed(filePath, options);
  }

  const text = await provider.transcribe(filePath, options);
  return {
    text,
    segments: [],
  };
}
