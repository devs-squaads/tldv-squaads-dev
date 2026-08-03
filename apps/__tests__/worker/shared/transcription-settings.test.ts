import { describe, expect, it } from "bun:test";
import {
  parseTranscriptionDictionary,
  parseDictionaryPairs,
} from "@meeting-bot/shared/services/transcriptionSettings";

describe("parseTranscriptionDictionary", () => {
  it("parses comma and newline separated terms", () => {
    const terms = parseTranscriptionDictionary("Squaads, Deepgram\nGroq");
    expect(terms).toEqual(["Squaads", "Deepgram", "Groq"]);
  });

  it("parses JSON arrays", () => {
    const terms = parseTranscriptionDictionary('["Zoom","Meet","Teams"]');
    expect(terms).toEqual(["Zoom", "Meet", "Teams"]);
  });

  it("deduplicates terms case-insensitively", () => {
    const terms = parseTranscriptionDictionary("Squaads\nsquaads\nSQUAADS");
    expect(terms).toEqual(["Squaads"]);
  });

  it("parses objects with a terms array", () => {
    const terms = parseTranscriptionDictionary('{"terms":["Alpha","Beta"]}');
    expect(terms).toEqual(["Alpha", "Beta"]);
  });

  it("includes the correct side of pairs as ASR keywords", () => {
    const terms = parseTranscriptionDictionary('"tldv" => "tl·dv"\nSquaads');
    expect(terms).toContain("tl·dv");
    expect(terms).toContain("Squaads");
    expect(terms).not.toContain("tldv");
  });
});

describe("parseDictionaryPairs", () => {
  it("parses quoted pair lines", () => {
    const pairs = parseDictionaryPairs('"tldv" => "tl·dv"');
    expect(pairs).toEqual([{ wrong: "tldv", correct: "tl·dv" }]);
  });

  it("parses unquoted pair lines", () => {
    const pairs = parseDictionaryPairs("squads => SQUAADS");
    expect(pairs).toEqual([{ wrong: "squads", correct: "SQUAADS" }]);
  });

  it("parses multiple lines mixing pairs and terms (terms ignored)", () => {
    const pairs = parseDictionaryPairs('"a" => "b"\nSquaads\n"x" => "y"');
    expect(pairs).toEqual([
      { wrong: "a", correct: "b" },
      { wrong: "x", correct: "y" },
    ]);
  });

  it("parses JSON array of pair strings", () => {
    const pairs = parseDictionaryPairs('["tldv => tl·dv", "squads => SQUAADS"]');
    expect(pairs).toHaveLength(2);
    expect(pairs[0]).toEqual({ wrong: "tldv", correct: "tl·dv" });
  });

  it("parses JSON array of pair objects", () => {
    const pairs = parseDictionaryPairs('[{"wrong": "tldv", "correct": "tl·dv"}]');
    expect(pairs).toEqual([{ wrong: "tldv", correct: "tl·dv" }]);
  });

  it("deduplicates pairs case-insensitively", () => {
    const pairs = parseDictionaryPairs('"tldv" => "tl·dv"\n"TLDV" => "tl·dv"');
    expect(pairs).toHaveLength(1);
  });

  it("returns empty for plain term dictionaries", () => {
    expect(parseDictionaryPairs("Squaads\nKubernetes")).toEqual([]);
    expect(parseDictionaryPairs("")).toEqual([]);
  });

  it("rejects pairs without a correct side", () => {
    const pairs = parseDictionaryPairs('"solo errónea" =>');
    expect(pairs).toEqual([]);
  });
});
