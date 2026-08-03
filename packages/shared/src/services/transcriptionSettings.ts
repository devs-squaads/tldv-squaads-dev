import {
  TranscriptionSettingsRepository,
} from "@meeting-bot/shared/repositories/TranscriptionSettingsRepository";
import type { DictionaryPair } from "@meeting-bot/shared/services/dictionaryRefinement";

const MAX_CONTEXT_LENGTH = 4000;
const MAX_DICTIONARY_TERM_LENGTH = 120;
const MAX_DICTIONARY_TERMS = 100;

export interface TranscriptionSettings {
  context: string;
  dictionary: string;
  dictionaryTerms: string[];
  dictionaryPairs: DictionaryPair[];
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

/** Parsea una línea "errónea" => "correcta" (con o sin comillas). */
function parsePairLine(line: string): DictionaryPair | null {
  const idx = line.indexOf("=>");
  if (idx === -1) {
    return null;
  }

  const wrongRaw = line.slice(0, idx).trim();
  const correctRaw = line.slice(idx + 2).trim();

  const unquote = (s: string) => {
    if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
      return s.slice(1, -1).trim();
    }
    if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
      return s.slice(1, -1).trim();
    }
    return s;
  };

  const wrong = unquote(wrongRaw);
  const correct = unquote(correctRaw);

  if (!wrong || !correct || wrong.length > MAX_DICTIONARY_TERM_LENGTH) {
    return null;
  }

  return { wrong, correct };
}

function uniquePairs(values: DictionaryPair[]): DictionaryPair[] {
  const seen = new Set<string>();
  const normalized: DictionaryPair[] = [];

  for (const pair of values) {
    const wrong = pair.wrong.trim().replace(/\s+/g, " ");
    const correct = pair.correct.trim().replace(/\s+/g, " ");
    if (!wrong || !correct) continue;

    const key = `${wrong.toLocaleLowerCase()}|${correct.toLocaleLowerCase()}`;
    if (seen.has(key)) continue;

    seen.add(key);
    normalized.push({ wrong, correct });
  }

  return normalized;
}

/**
 * Parsea el diccionario en pares errónea => correcta.
 * Acepta: líneas `"a" => "b"` (o `a => b`), JSON de objetos {wrong, correct},
 * y JSON de strings con sintaxis de par. Devuelve [] si no hay pares.
 */
export function parseDictionaryPairs(value: string): DictionaryPair[] {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  const pairs: DictionaryPair[] = [];

  // Intentar JSON primero (array de objetos {wrong, correct} o strings con "=>").
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        if (typeof entry === "string") {
          const pair = parsePairLine(entry);
          if (pair) pairs.push(pair);
        } else if (entry && typeof entry === "object") {
          const obj = entry as Record<string, unknown>;
          const wrong = typeof obj.wrong === "string" ? obj.wrong : null;
          const correct = typeof obj.correct === "string" ? obj.correct : null;
          if (wrong && correct) pairs.push({ wrong, correct });
        }
      }
      return uniquePairs(pairs);
    }
    // { "terms": [...] } legacy → sin pares
    return [];
  } catch {
    // no es JSON → parsear por líneas
  }

  // Solo líneas: los pares se parsean línea a línea SIN partir por comas/punto y
  // coma, porque un par puede contenerlos dentro de wrong/correct
  // (ej. "excelsic" => "Excel, CSV"). El split por separadores solo aplica a
  // términos planos (sin "=>"), en parseTranscriptionDictionary.
  for (const line of trimmed.split("\n")) {
    const pair = parsePairLine(line);
    if (pair) pairs.push(pair);
  }

  return uniquePairs(pairs);
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

/**
 * Parsea el diccionario en términos (keywords de ASR).
 * Mantiene la semántica anterior (términos planos) y añade la parte `correct`
 * de cada par errónea => correcta, para que el ASR priorice la forma correcta.
 */
export function parseTranscriptionDictionary(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  const pairs = parseDictionaryPairs(trimmed);
  const pairCorrect = pairs.map((p) => p.correct);

  const jsonTerms = parseJsonDictionary(trimmed);
  if (jsonTerms) {
    return uniqueTerms([...jsonTerms, ...pairCorrect]);
  }

  // Términos planos: líneas SIN "=>", partidas por comas/punto y coma (legacy:
  // "Squaads, Deepgram"). Las líneas con "=>" son pares y NO se parten por
  // comas (un par puede contenerlas dentro de wrong/correct).
  const bareTerms: string[] = [];
  for (const line of trimmed.split("\n")) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.includes("=>")) {
      continue;
    }
    bareTerms.push(...trimmedLine.split(/[,;]+/).map((s) => s.trim()).filter(Boolean));
  }

  return uniqueTerms([...bareTerms, ...pairCorrect]);
}

function normalizeDictionary(value: unknown): { raw: string; terms: string[]; pairs: DictionaryPair[] } {
  if (Array.isArray(value)) {
    const terms = uniqueTerms(value.map((entry) => String(entry ?? "")));
    return {
      raw: terms.join("\n"),
      terms,
      pairs: [],
    };
  }

  if (typeof value !== "string") {
    return { raw: "", terms: [], pairs: [] };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { raw: "", terms: [], pairs: [] };
  }

  const terms = parseTranscriptionDictionary(trimmed);
  const pairs = parseDictionaryPairs(trimmed);
  return {
    raw: trimmed,
    terms,
    pairs,
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
    dictionaryPairs: parseDictionaryPairs(dictionary),
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
    dictionaryPairs: dictionary.pairs,
  };
}
