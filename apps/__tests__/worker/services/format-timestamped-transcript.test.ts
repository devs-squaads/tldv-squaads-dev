/// <reference types="bun" />

import { describe, expect, it } from "bun:test";
import { formatTimestampedTranscript } from "../../../worker/src/services/gemini";

describe("formatTimestampedTranscript (spec 014/016)", () => {
  it("serializes a segment with speaker as `Nombre [MM:SS]: texto`", () => {
    const out = formatTimestampedTranscript([{ start: 75, end: 80, text: "hola", speaker: "Marta" }]);

    expect(out).toBe("Marta [01:15]: hola");
  });

  it("keeps the colon that the refiner prompt and the spec expect", () => {
    const out = formatTimestampedTranscript([
      { start: 0, end: 3, text: "buenos días", speaker: "Participante 1" },
    ]);

    expect(out).toContain("Participante 1 [00:00]: buenos días");
    // El bug de la 014: se serializaba sin dos puntos y el refiner recibía un formato
    // distinto del que su propio prompt le pide preservar.
    expect(out).not.toContain("Participante 1 [00:00] buenos días");
  });

  it("serializes a segment without speaker as `[MM:SS] texto`", () => {
    const out = formatTimestampedTranscript([{ start: 75, end: 80, text: "hola" }]);

    expect(out).toBe("[01:15] hola");
  });

  it("zips past an hour of meeting without losing the minute", () => {
    const out = formatTimestampedTranscript([
      { start: 3725, end: 3730, text: "seguimos", speaker: "Ana" },
    ]);

    expect(out).toBe("Ana [62:05]: seguimos");
  });

  it("joins segments with a newline", () => {
    const out = formatTimestampedTranscript([
      { start: 0, end: 1, text: "uno", speaker: "A" },
      { start: 1, end: 2, text: "dos", speaker: "B" },
    ]);

    expect(out.split("\n")).toEqual(["A [00:00]: uno", "B [00:01]: dos"]);
  });

  it("round-trips the format that the attribution parser expects", () => {
    const out = formatTimestampedTranscript([{ start: 12, end: 15, text: "vale", speaker: "Luis" }]);
    const match = out.match(/^(.+?)\s*\[(\d{1,2}):(\d{2})\]\s*:\s*(.+)$/);

    expect(match).not.toBeNull();
    expect(match?.[1]).toBe("Luis");
  });
});
