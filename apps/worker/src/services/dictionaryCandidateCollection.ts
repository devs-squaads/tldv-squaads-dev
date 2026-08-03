/**
 * dictionaryCandidateCollection.ts — Recolecta candidatos de corrección tras
 * cada refinado (port de refine_dictionary.py). El pipeline NUNCA puede romperse
 * por esto: el hook del caller va en try/catch.
 */
import {
  analyzeRawVsClean,
  mergeCandidateCounts,
  type DictionaryPair,
  type DictionarySuggestion,
} from "@meeting-bot/shared/services/dictionaryRefinement";
import {
  loadDictionaryCandidates,
  saveDictionaryCandidates,
} from "@/repositories/DictionaryCandidateRepository";

/**
 * Analiza raw vs clean y acumula los candidatos detectados en settings.
 * Devuelve los nuevos candidatos detectados (solo informativo).
 */
export async function accumulateDictionaryCandidates(
  raw: string,
  clean: string,
  existingPairs: DictionaryPair[] = [],
): Promise<DictionarySuggestion[]> {
  const suggestions = analyzeRawVsClean(raw, clean, existingPairs);
  if (!suggestions.length) {
    return [];
  }

  const current = await loadDictionaryCandidates();
  const merged = mergeCandidateCounts(current, suggestions);
  await saveDictionaryCandidates(merged);

  return suggestions;
}
