import { describe, expect, it } from "bun:test";
import { parseTranscriptionDictionary } from "@meeting-bot/shared/services/transcriptionSettings";

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
});
