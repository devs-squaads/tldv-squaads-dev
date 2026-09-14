import type { SummaryResult } from "@meeting-bot/shared/integrations/ai/summary/types";
import { SummaryProviderFactory } from "@/integrations/ai/summary/SummaryProviderFactory";
import type {
  TranscriptionProvider,
  TranscriptionProviderOptions,
  TranscriptionProviderResult,
  TranscriptionSegment,
} from "@/integrations/ai/transcription/TranscriptionProvider";
import { TranscriptionProviderFactory } from "@/integrations/ai/transcription/TranscriptionProviderFactory";
import { formatTimestampedTranscript, refineTranscript } from "@/services/gemini";
import { prepareTranscriptionAudio } from "@/services/audioPreprocessing";
import { mergeChunkSegments } from "@/services/transcriptionInput";
import {
  getTranscriptionSettings,
  type TranscriptionSettings,
} from "@meeting-bot/shared/services/transcriptionSettings";
import { applyDictionaryPairs } from "@meeting-bot/shared/services/dictionaryRefinement";
import {
  attributeSpeakersToSegments,
  isSpeakerAttributionEnabled,
} from "@/services/speakerAttribution";

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
 * Dictionary pairs (errónea => correcta) se aplican de forma determinista ANTES
 * del LLM, de modo que una corrección conocida se aplica aunque el LLM falle.
 */
export async function refineTranscriptionResult(
  transcription: TranscriptionProviderResult,
  settings: TranscriptionSettings,
): Promise<TranscriptionProviderResult> {
  const context = settings.context?.trim();
  if (!context && !settings.dictionaryPairs?.length) {
    return transcription;
  }

  const rawInput = applyDictionaryPairs(
    serializeTranscript(transcription.segments, transcription.text),
    settings.dictionaryPairs || [],
  );
  if (!rawInput.trim()) {
    return transcription;
  }

  try {
    const refinedText = await refineTranscript(
      rawInput,
      context,
      settings.dictionaryTerms,
      settings.dictionaryPairs,
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

  // El proveedor recibe SIEMPRE audio, nunca el vídeo: la API de ASR rechaza el MP4 de una reunión
  // larga con 413 (spec 016). La preparación cubre los dos caminos que transcriben (pipeline y
  // reprocesado) porque ambos pasan por aquí.
  //
  // El límite lo declara el proveedor, así que el troceo se ajusta a él y no a un valor cableado: el
  // de Gemini (datos en línea, ~12 MB) es bastante menor que el de Deepgram.
  const prepared = await prepareTranscriptionAudio(filePath, { maxBytes: provider.maxInputBytes });

  try {
    if (prepared.files.length === 1) {
      const result = await runProvider(provider, prepared.files[0], options);
      return attributeSpeakersIfNeeded(withDuration(result, prepared.durationSeconds));
    }

    const partials: TranscriptionProviderResult[] = [];
    for (const file of prepared.files) {
      partials.push(await runProvider(provider, file, options));
    }

    // Un proveedor que sólo implementa `transcribe` devuelve texto sin segmentos. Sin este camino, la
    // fusión (que trabaja sobre segmentos) descartaría todo el texto y la reunión larga se quedaría
    // sin transcripción. Se concatenan los textos en el orden de los fragmentos.
    const hasSegments = partials.some((partial) => partial.segments.length > 0);
    if (!hasSegments) {
      return attributeSpeakersIfNeeded({
        text: partials.map((partial) => partial.text.trim()).filter(Boolean).join("\n"),
        segments: [],
        durationSeconds: prepared.durationSeconds,
      });
    }

    const mergedSegments = mergeChunkSegments(
      prepared.chunks,
      partials.map((partial) => partial.segments),
    );

    return attributeSpeakersIfNeeded({
      text: formatTimestampedTranscript(mergedSegments),
      segments: mergedSegments,
      durationSeconds: prepared.durationSeconds,
    });
  } finally {
    prepared.cleanup();
  }
}

async function runProvider(
  provider: TranscriptionProvider,
  filePath: string,
  options?: TranscriptionProviderOptions,
): Promise<TranscriptionProviderResult> {
  if (provider.transcribeDetailed) {
    return provider.transcribeDetailed(filePath, options);
  }

  const text = await provider.transcribe(filePath, options);
  return { text, segments: [] };
}

function withDuration(
  result: TranscriptionProviderResult,
  durationSeconds: number,
): TranscriptionProviderResult {
  if (result.durationSeconds || !durationSeconds) {
    return result;
  }
  return { ...result, durationSeconds };
}

/**
 * Si los segmentos no traen hablante (Groq Whisper no diariza) y la atribución
 * está habilitada, la ejecuta vía LLM. Cualquier fallo degrada silenciosamente
 * al resultado original (nunca rompe el pipeline).
 */
export async function attributeSpeakersIfNeeded(
  result: TranscriptionProviderResult,
): Promise<TranscriptionProviderResult> {
  const hasSegments = Array.isArray(result.segments) && result.segments.length > 0;
  if (!hasSegments || !isSpeakerAttributionEnabled()) {
    return result;
  }

  const allHaveSpeakers = result.segments.every((s: TranscriptionSegment) => Boolean(s.speaker));
  if (allHaveSpeakers) {
    return result;
  }

  try {
    const attributed = await attributeSpeakersToSegments(result.segments);
    return {
      ...result,
      segments: attributed,
      text: formatTimestampedTranscript(attributed),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[transcribeRecording] Speaker attribution failed, keeping raw transcript: ${message}`);
    return result;
  }
}
