/**
 * dictionaryRefinement.ts — Lógica pura de diccionario de correcciones y
 * auto-refinamiento (port de `refine_dictionary.py` de clean_transcriptions).
 *
 * Sin dependencias externas: todo es testeable sin mocks.
 */

export interface DictionaryPair {
  wrong: string;
  correct: string;
}

export interface DictionarySuggestion {
  wrong: string;
  correct: string | null;
  rawCount: number;
  cleanCount: number;
  score: number;
  likelyCorrection: boolean;
}

export interface CandidateCount {
  wrong: string;
  correct: string;
  hits: number;
}

/** Muletillas y confirmaciones de escucha sin valor (nuestras reglas de limpieza). */
export const FILLER_WORDS = new Set([
  "vale", "sabes", "digamos", "bueno", "claro", "entonces", "eeeeh", "aaaah",
  "mmmm", "mmm", "esto", "como", "tipo", "ajá", "aja", "ahi", "sí", "si", "no",
  "ah", "eh", "oh", "uf", "ay", "pues", "mira", "vamos", "digo", "o sea", "osea",
  "ya", "bien", "oye", "mm", "um", "em", "este",
]);

const MIN_WRONG_LENGTH = 3;
const MIN_CANDIDATE_DIFF = 2;
const MIN_CANDIDATE_LENGTH = 4;

/**
 * Aplica pares errónea => correcta de forma determinista sobre el texto.
 * Reemplazo por límite de palabra (unicode-aware, case-insensitive) para no
 * sobre-corregir prefijos/sufijos. La función de reemplazo evita que `$` del
 * valor correcto se interprete como patrón de sustitución.
 */
export function applyDictionaryPairs(text: string, pairs: DictionaryPair[]): string {
  let result = text;

  for (const pair of pairs) {
    const wrong = pair.wrong.trim();
    const correct = pair.correct.trim();

    if (wrong.length < MIN_WRONG_LENGTH || !correct) {
      continue;
    }

    const escaped = wrong.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Límites de palabra unicode: no reemplazar dentro de otra palabra.
    const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "giu");

    result = result.replace(re, () => correct);
  }

  return result;
}

const WORD_RE = /[a-záéíóúñüçàèìòùâêîôûäëïöãõ]+/giu;

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(WORD_RE) || []).filter((w) => w.length > 0);
}

function countFrequencies(words: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const word of words) {
    freq.set(word, (freq.get(word) || 0) + 1);
  }
  return freq;
}

/** Similitud rápida: subcadena o ≤2 caracteres distintos (port de _similar). */
export function wordsSimilar(a: string, b: string): boolean {
  if (a.length < 3 || b.length < 3) {
    return false;
  }
  if (Math.abs(a.length - b.length) > 3) {
    return false;
  }
  if (a.includes(b) || b.includes(a)) {
    return true;
  }
  // Igual que el zip() de Python: compara solo el solapamiento (min length).
  let diffs = 0;
  const overlap = Math.min(a.length, b.length);
  for (let i = 0; i < overlap; i += 1) {
    if (a[i] !== b[i]) {
      diffs += 1;
      if (diffs > 2) {
        return false;
      }
    }
  }
  return diffs <= 2;
}

/**
 * Compara transcripción cruda vs refinada y detecta patrones de error
 * recurrentes (port de `extract_clean_changes` + scoring de refine_dictionary.py).
 */
export function analyzeRawVsClean(
  raw: string,
  clean: string,
  existingPairs: DictionaryPair[] = [],
): DictionarySuggestion[] {
  const rawFreq = countFrequencies(tokenize(raw));
  const cleanFreq = countFrequencies(tokenize(clean));

  const existingKeys = new Set(
    existingPairs.map(
      (p) => `${p.wrong.trim().toLowerCase()}|${p.correct.trim().toLowerCase()}`,
    ),
  );

  const suggestions: DictionarySuggestion[] = [];

  for (const [word, rawCount] of rawFreq) {
    const cleanCount = cleanFreq.get(word) || 0;
    const diff = rawCount - cleanCount;

    if (diff < MIN_CANDIDATE_DIFF || word.length < MIN_CANDIDATE_LENGTH) {
      continue;
    }
    if (FILLER_WORDS.has(word)) {
      continue;
    }

    // ¿Hay una palabra parecida en el texto limpio que pueda ser la corrección?
    let bestMatch: string | null = null;
    let bestCount = 0;
    for (const [cleanWord, cleanWordCount] of cleanFreq) {
      if (cleanWord === word || cleanWordCount === 0) {
        continue;
      }
      if (wordsSimilar(word, cleanWord) && cleanWordCount > bestCount) {
        bestMatch = cleanWord;
        bestCount = cleanWordCount;
      }
    }

    if (bestMatch) {
      const key = `${word}|${bestMatch}`;
      if (existingKeys.has(key)) {
        continue;
      }
      suggestions.push({
        wrong: word,
        correct: bestMatch,
        rawCount,
        cleanCount,
        score: diff * 3,
        likelyCorrection: true,
      });
    } else {
      // Palabra que desapareció sin reemplazo claro: candidato débil (posible
      // error eliminado o palabra que el refiner reformuló).
      suggestions.push({
        wrong: word,
        correct: null,
        rawCount,
        cleanCount,
        score: diff,
        likelyCorrection: false,
      });
    }
  }

  return suggestions
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
}

/**
 * Acumula candidatos con contador de hits (persistencia en settings).
 * Dedup por (wrong, correct) case-insensitive; ordenado por hits desc;
 * cap de entradas para no crecer sin límite.
 */
export function mergeCandidateCounts(
  existing: CandidateCount[],
  suggestions: DictionarySuggestion[],
  maxEntries = 200,
): CandidateCount[] {
  const byKey = new Map<string, CandidateCount>();

  for (const c of existing) {
    const key = `${c.wrong.toLowerCase()}|${c.correct.toLowerCase()}`;
    byKey.set(key, { ...c });
  }

  for (const s of suggestions) {
    if (!s.correct) {
      continue; // solo promocionables los pares con corrección clara
    }
    const key = `${s.wrong.toLowerCase()}|${s.correct.toLowerCase()}`;
    const current = byKey.get(key);
    if (current) {
      current.hits += s.rawCount;
    } else {
      byKey.set(key, { wrong: s.wrong, correct: s.correct, hits: s.rawCount });
    }
  }

  return [...byKey.values()]
    .sort((a, b) => b.hits - a.hits)
    .slice(0, maxEntries);
}

/** Formatea pares para el bloque de correcciones del prompt del refiner. */
export function formatDictionaryPairs(pairs: DictionaryPair[]): string {
  if (!pairs.length) {
    return "";
  }
  const lines = pairs.map((p) => `- "${p.wrong}" → "${p.correct}"`);
  return `\n\nCORRECCIONES OBLIGATORIAS DE TERMINOLOGÍA (si el audio dice la forma errónea, escribe SIEMPRE la forma correcta):\n${lines.join("\n")}`;
}
