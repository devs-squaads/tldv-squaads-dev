import {
  TranscriptionSettingsRepository,
} from "@meeting-bot/shared/repositories/TranscriptionSettingsRepository";

const MAX_CONTEXT_LENGTH = 4000;
const MAX_DICTIONARY_TERM_LENGTH = 120;
const MAX_DICTIONARY_TERMS = 100;

export interface TranscriptionSettings {
  context: string;
  dictionary: string;
  dictionaryTerms: string[];
}

function normalizeContext(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  return trimmed.slice(0, MAX_CONTEXT_LENGTH);
}

function uniqueTerms(values: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values) {
    const term = value.trim().replace(/\s+/g, " ");
    if (!term) continue;

    const capped = term.slice(0, MAX_DICTIONARY_TERM_LENGTH);
    const key = capped.toLocaleLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    normalized.push(capped);

    if (normalized.length >= MAX_DICTIONARY_TERMS) {
      break;
    }
  }

  return normalized;
}

function parseJsonDictionary(value: string): string[] | null {
  try {
    const parsed = JSON.parse(value) as unknown;

    if (Array.isArray(parsed)) {
      return uniqueTerms(parsed.map((entry) => String(entry ?? "")));
    }

    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { terms?: unknown }).terms)) {
      return uniqueTerms((parsed as { terms: unknown[] }).terms.map((entry) => String(entry ?? "")));
    }

    return null;
  } catch {
    return null;
  }
}

export function parseTranscriptionDictionary(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  const jsonTerms = parseJsonDictionary(trimmed);
  if (jsonTerms) {
    return jsonTerms;
  }

  return uniqueTerms(trimmed.split(/[\n,;]+/));
}

function normalizeDictionary(value: unknown): { raw: string; terms: string[] } {
  if (Array.isArray(value)) {
    const terms = uniqueTerms(value.map((entry) => String(entry ?? "")));
    return {
      raw: terms.join("\n"),
      terms,
    };
  }

  if (typeof value !== "string") {
    return { raw: "", terms: [] };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { raw: "", terms: [] };
  }

  const terms = parseTranscriptionDictionary(trimmed);
  return {
    raw: trimmed,
    terms,
  };
}

export async function getTranscriptionSettings(): Promise<TranscriptionSettings> {
  const { context: contextValue, dictionary: dictionaryValue } = await TranscriptionSettingsRepository.get();

  const context = normalizeContext(contextValue ?? "");
  const dictionary = typeof dictionaryValue === "string" ? dictionaryValue.trim() : "";

  return {
    context,
    dictionary,
    dictionaryTerms: parseTranscriptionDictionary(dictionary),
  };
}

export async function saveTranscriptionSettings(input: {
  context?: unknown;
  dictionary?: unknown;
}): Promise<TranscriptionSettings> {
  const context = normalizeContext(input.context);
  const dictionary = normalizeDictionary(input.dictionary);

  await TranscriptionSettingsRepository.save({
    context,
    dictionary: dictionary.raw,
  });

  return {
    context,
    dictionary: dictionary.raw,
    dictionaryTerms: dictionary.terms,
  };
}
