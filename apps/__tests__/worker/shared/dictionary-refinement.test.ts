import { describe, expect, it } from "bun:test";
import {
  applyDictionaryPairs,
  analyzeRawVsClean,
  mergeCandidateCounts,
  formatDictionaryPairs,
  wordsSimilar,
  type DictionarySuggestion,
} from "@meeting-bot/shared/services/dictionaryRefinement";

describe("applyDictionaryPairs", () => {
  it("replaces a known wrong term with the correct one (case-insensitive)", () => {
    const text = "hablamos de tldv y TLDV en la reunión";
    const result = applyDictionaryPairs(text, [{ wrong: "tldv", correct: "tl·dv" }]);
    expect(result).toBe("hablamos de tl·dv y tl·dv en la reunión");
  });

  it("does not replace inside other words (word boundaries)", () => {
    const text = "squads squads-dev squaads";
    const result = applyDictionaryPairs(text, [{ wrong: "squads", correct: "SQUAADS" }]);
    // "squads-dev" contiene "squads" como token (el guion no es letra): se corrige.
    expect(result).toBe("SQUAADS SQUAADS-dev squaads");
  });

  it("preserves accents and unicode letters in boundaries", () => {
    const text = "estación ok, estaciones ok";
    const result = applyDictionaryPairs(text, [{ wrong: "estacion", correct: "estación" }]);
    expect(result).toBe("estación ok, estaciones ok");
  });

  it("ignores pairs with too-short wrong terms", () => {
    const text = "de la de";
    const result = applyDictionaryPairs(text, [{ wrong: "de", correct: "DE" }]);
    expect(result).toBe(text);
  });

  it("does not interpret $ in the correct value as a replacement pattern", () => {
    const text = "coste 100 usd";
    const result = applyDictionaryPairs(text, [{ wrong: "usd", correct: "$100" }]);
    expect(result).toBe("coste 100 $100");
  });

  it("returns the input unchanged when there are no pairs", () => {
    const text = "cualquier cosa";
    expect(applyDictionaryPairs(text, [])).toBe(text);
  });
});

describe("wordsSimilar", () => {
  it("detects substring similarity", () => {
    expect(wordsSimilar("squad", "squads")).toBe(true);
    expect(wordsSimilar("squads", "squaads")).toBe(true); // 2 diffs en el solapamiento
    expect(wordsSimilar("kafka", "kafka")).toBe(true);
  });

  it("rejects words that differ too much", () => {
    expect(wordsSimilar("hola", "kafka")).toBe(false);
    expect(wordsSimilar("abc", "xyz")).toBe(false);
  });
});

describe("analyzeRawVsClean", () => {
  const raw = [
    "la reunión con squads fue larga",
    "squads nos pidió el informe",
    "squads está contento con el avance",
  ].join("\n");
  const clean = [
    "la reunión con SQUAADS fue larga",
    "SQUAADS nos pidió el informe",
    "SQUAADS está contento con el avance",
  ].join("\n");

  it("detects recurring raw->clean corrections", () => {
    const suggestions = analyzeRawVsClean(raw, clean);
    const squads = suggestions.find((s) => s.wrong === "squads" && s.correct === "squaads");
    expect(squads).toBeDefined();
    expect(squads?.rawCount).toBe(3);
    expect(squads?.likelyCorrection).toBe(true);
  });

  it("filters filler words", () => {
    const rawFiller = "vale vale vale y entonces bueno";
    const cleanFiller = "y";
    const suggestions = analyzeRawVsClean(rawFiller, cleanFiller);
    expect(suggestions.some((s) => s.wrong === "vale")).toBe(false);
  });

  it("excludes candidates already present in the dictionary", () => {
    const suggestions = analyzeRawVsClean(raw, clean, [{ wrong: "squads", correct: "squaads" }]);
    expect(suggestions.some((s) => s.wrong === "squads")).toBe(false);
  });

  it("returns suggestions sorted by score desc", () => {
    const rawMulti = [
      "hablamos de kafka y kafka y kafka otra vez",
      "tambien mencinamos kafka al final",
      "y por supuesto kafka en el cierre",
    ].join("\n");
    const cleanMulti = [
      "hablamos de Kafka y Kafka y Kafka otra vez",
      "tambien mencinamos Kafka al final",
      "y por supuesto Kafka en el cierre",
    ].join("\n");
    const suggestions = analyzeRawVsClean(rawMulti, cleanMulti);
    const scores = suggestions.map((s: DictionarySuggestion) => s.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(suggestions.length).toBeLessThanOrEqual(20);
  });
});

describe("mergeCandidateCounts", () => {
  it("accumulates hits across meetings and dedupes", () => {
    const existing = [{ wrong: "squads", correct: "squaads", hits: 2 }];
    const suggestions: DictionarySuggestion[] = [
      {
        wrong: "squads",
        correct: "squaads",
        rawCount: 3,
        cleanCount: 0,
        score: 9,
        likelyCorrection: true,
      },
      {
        wrong: "kafka",
        correct: "Kafka",
        rawCount: 4,
        cleanCount: 0,
        score: 12,
        likelyCorrection: true,
      },
      { wrong: "xyz", correct: null, rawCount: 5, cleanCount: 0, score: 5, likelyCorrection: false },
    ];

    const merged = mergeCandidateCounts(existing, suggestions);
    expect(merged).toHaveLength(2);
    const squads = merged.find((c) => c.wrong === "squads");
    expect(squads?.hits).toBe(5);
    expect(merged.find((c) => c.wrong === "xyz")).toBeUndefined();
  });

  it("respects the max entries cap", () => {
    const suggestions: DictionarySuggestion[] = Array.from({ length: 10 }, (_, i) => ({
      wrong: `w${i}`,
      correct: `c${i}`,
      rawCount: i + 1,
      cleanCount: 0,
      score: i + 1,
      likelyCorrection: true,
    }));
    const merged = mergeCandidateCounts([], suggestions, 3);
    expect(merged).toHaveLength(3);
    expect(merged[0]?.hits).toBe(10);
  });
});

describe("formatDictionaryPairs", () => {
  it("formats pairs as a block of correction rules", () => {
    const block = formatDictionaryPairs([{ wrong: "tldv", correct: "tl·dv" }]);
    expect(block).toContain('"tldv" → "tl·dv"');
    expect(block).toContain("CORRECCIONES OBLIGATORIAS");
  });

  it("returns empty string for no pairs", () => {
    expect(formatDictionaryPairs([])).toBe("");
  });
});
