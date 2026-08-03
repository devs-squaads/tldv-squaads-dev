import { afterEach, describe, expect, it } from "bun:test";
import {
  segmentsToLines,
  chunkLines,
  buildAttributionPrompt,
  parseAttributedLines,
  attributedLinesToSegments,
  isSpeakerAttributionEnabled,
} from "../../../worker/src/services/speakerAttribution";
import type { TranscriptionSegment } from "../../../worker/src/integrations/ai/transcription/TranscriptionProvider";

const ORIGINAL_ENV = process.env.SPEAKER_ATTRIBUTION_ENABLED;

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.SPEAKER_ATTRIBUTION_ENABLED;
  } else {
    process.env.SPEAKER_ATTRIBUTION_ENABLED = ORIGINAL_ENV;
  }
});

const segments: TranscriptionSegment[] = [
  { start: 0, end: 5, text: "hola a todos" },
  { start: 65, end: 70, text: "empecemos con el roadmap" },
];

describe("segmentsToLines", () => {
  it("formats [MM:SS] lines from segments", () => {
    const lines = segmentsToLines(segments);
    expect(lines).toEqual(["[00:00] hola a todos", "[01:05] empecemos con el roadmap"]);
  });
});

describe("chunkLines", () => {
  it("keeps a single chunk when under the limit", () => {
    const chunks = chunkLines(["a", "b"], 100);
    expect(chunks).toEqual([["a", "b"]]);
  });

  it("splits into multiple chunks respecting the char limit", () => {
    const lines = ["12345", "12345", "12345"];
    const chunks = chunkLines(lines, 12);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flat()).toEqual(lines);
  });
});

describe("buildAttributionPrompt", () => {
  it("contains the chunk, part index and speaker rules", () => {
    const prompt = buildAttributionPrompt("[00:00] hola", 0, 2);
    expect(prompt).toContain("Participante 1");
    expect(prompt).toContain("parte 1 de 2");
    expect(prompt).toContain("[00:00] hola");
    expect(prompt).toContain("Formato de salida EXACTO");
  });
});

describe("parseAttributedLines", () => {
  it("parses speaker-prefixed lines", () => {
    const lines = parseAttributedLines("Participante 1 [00:00]: hola a todos\nParticipante 2 [01:05]: empecemos");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ speaker: "Participante 1", start: 0, text: "hola a todos" });
    expect(lines[1]).toMatchObject({ speaker: "Participante 2", start: 65, text: "empecemos" });
  });

  it("parses named speakers", () => {
    const lines = parseAttributedLines("Marta [00:00]: hola");
    expect(lines[0]?.speaker).toBe("Marta");
  });

  it("tolerates plain timestamps by defaulting the speaker", () => {
    const lines = parseAttributedLines("[00:00] hola a todos");
    expect(lines[0]?.speaker).toBe("Participante 1");
    expect(lines[0]?.text).toBe("hola a todos");
  });

  it("returns empty for input without lines", () => {
    expect(parseAttributedLines("")).toEqual([]);
    expect(parseAttributedLines("sin formato ninguno")).toEqual([]);
  });
});

describe("attributedLinesToSegments", () => {
  it("reuses original durations when timestamps match", () => {
    const attributed = [
      { speaker: "Participante 1", start: 0, end: 5, text: "hola a todos" },
    ];
    const result = attributedLinesToSegments(attributed, segments);
    expect(result[0]).toMatchObject({ speaker: "Participante 1", start: 0, end: 5, text: "hola a todos" });
  });

  it("returns attributed segments when nothing matches (fallback)", () => {
    const attributed = [
      { speaker: "Participante 1", start: 999, end: 1004, text: "texto" },
    ];
    const result = attributedLinesToSegments(attributed, segments);
    expect(result[0]?.speaker).toBe("Participante 1");
    expect(result[0]?.start).toBe(999);
  });

  it("returns the original segments when attribution is empty", () => {
    const result = attributedLinesToSegments([], segments);
    expect(result).toEqual(segments);
    expect(result[0]?.speaker).toBeUndefined();
  });
});

describe("isSpeakerAttributionEnabled", () => {
  it("defaults to enabled", () => {
    delete process.env.SPEAKER_ATTRIBUTION_ENABLED;
    expect(isSpeakerAttributionEnabled()).toBe(true);
  });

  it("honors SPEAKER_ATTRIBUTION_ENABLED=false", () => {
    process.env.SPEAKER_ATTRIBUTION_ENABLED = "false";
    expect(isSpeakerAttributionEnabled()).toBe(false);
  });
});
