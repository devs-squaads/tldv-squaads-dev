/// <reference types="bun" />

import { describe, expect, it } from "bun:test";
import {
  DEFAULT_CHUNK_SECONDS,
  DEFAULT_MAX_UPLOAD_BYTES,
  DEFAULT_OVERLAP_SECONDS,
  mergeChunkSegments,
  planTranscriptionInput,
} from "../../../worker/src/services/transcriptionInput";

const MB = 1024 * 1024;

describe("planTranscriptionInput · audio que cabe (spec 016)", () => {
  it("does not chunk when the extracted audio fits the provider limit", () => {
    const plan = planTranscriptionInput({ audioBytes: 9 * MB, durationSeconds: 3212 });

    expect(plan.needsChunking).toBe(false);
    expect(plan.oversizeAfterExtraction).toBe(false);
    expect(plan.chunks).toEqual([{ index: 0, startSeconds: 0, durationSeconds: 3212 }]);
  });

  it("treats an audio exactly at the limit as fitting", () => {
    const plan = planTranscriptionInput({
      audioBytes: DEFAULT_MAX_UPLOAD_BYTES,
      durationSeconds: 600,
    });

    expect(plan.needsChunking).toBe(false);
  });
});

describe("planTranscriptionInput · audio que no cabe (spec 016)", () => {
  it("chunks when the audio is over the limit", () => {
    const plan = planTranscriptionInput({ audioBytes: 60 * MB, durationSeconds: 7200 });

    expect(plan.needsChunking).toBe(true);
    expect(plan.oversizeAfterExtraction).toBe(true);
    expect(plan.chunks.length).toBeGreaterThan(1);
  });

  it("covers the whole duration without leaving a gap at the start", () => {
    const plan = planTranscriptionInput({ audioBytes: 60 * MB, durationSeconds: 7200 });
    const first = plan.chunks[0];
    const last = plan.chunks[plan.chunks.length - 1];

    expect(first.startSeconds).toBe(0);
    expect(last.startSeconds + last.durationSeconds).toBeGreaterThanOrEqual(7200);
  });

  it("overlaps consecutive chunks so a word is not cut in half", () => {
    const plan = planTranscriptionInput({ audioBytes: 60 * MB, durationSeconds: 7200 });
    const [a, b] = plan.chunks;

    expect(b.startSeconds).toBeLessThan(a.startSeconds + a.durationSeconds);
    expect(a.startSeconds + a.durationSeconds - b.startSeconds).toBe(DEFAULT_OVERLAP_SECONDS);
  });

  it("uses the documented defaults", () => {
    const plan = planTranscriptionInput({ audioBytes: 60 * MB, durationSeconds: 4000 });

    expect(plan.chunks[0].durationSeconds).toBe(Math.min(DEFAULT_CHUNK_SECONDS, 4000));
  });

  it("honours a custom chunk size and overlap", () => {
    const plan = planTranscriptionInput({
      audioBytes: 60 * MB,
      durationSeconds: 100,
      chunkSeconds: 40,
      overlapSeconds: 10,
    });

    expect(plan.chunks.map((c) => c.startSeconds)).toEqual([0, 30, 60, 90]);
  });

  it("never produces a zero step, even with a nonsensical overlap", () => {
    const plan = planTranscriptionInput({
      audioBytes: 60 * MB,
      durationSeconds: 100,
      chunkSeconds: 40,
      overlapSeconds: 40,
    });

    expect(plan.chunks.length).toBeGreaterThan(0);
    expect(plan.chunks.every((c, i) => i === 0 || c.startSeconds > plan.chunks[i - 1].startSeconds)).toBe(true);
  });

  it("still returns one chunk when the duration is unknown", () => {
    const plan = planTranscriptionInput({ audioBytes: 60 * MB, durationSeconds: 0 });

    expect(plan.chunks).toHaveLength(1);
    expect(plan.needsChunking).toBe(false);
  });
});

describe("mergeChunkSegments (spec 016)", () => {
  it("shifts chunk timestamps by the chunk start", () => {
    const merged = mergeChunkSegments(
      [{ startSeconds: 0 }, { startSeconds: 900 }],
      [
        [{ start: 0, end: 5, text: "hola" }],
        [{ start: 2, end: 8, text: "mundo" }],
      ],
    );

    expect(merged).toEqual([
      { start: 0, end: 5, text: "hola" },
      { start: 902, end: 908, text: "mundo" },
    ]);
  });

  it("drops the duplicated segment from the overlap region", () => {
    // El fragmento 2 arranca en 895, así que su [0,10] es el [895,905] absoluto: solapa con el
    // segmento [890,900] del fragmento 1 y se descarta por completo.
    const merged = mergeChunkSegments(
      [{ startSeconds: 0 }, { startSeconds: 895 }],
      [
        [{ start: 890, end: 900, text: "repetido" }],
        [{ start: 0, end: 10, text: "repetido" }],
      ],
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].text).toBe("repetido");
  });

  it("keeps what comes after the overlap", () => {
    const merged = mergeChunkSegments(
      [{ startSeconds: 0 }, { startSeconds: 895 }],
      [
        [{ start: 890, end: 900, text: "repetido" }],
        [
          { start: 0, end: 10, text: "repetido" },
          { start: 20, end: 30, text: "nuevo" },
        ],
      ],
    );

    expect(merged.map((s) => s.text)).toEqual(["repetido", "nuevo"]);
    expect(merged[1].start).toBe(915);
  });

  it("preserves extra fields such as the speaker label", () => {
    const merged = mergeChunkSegments(
      [{ startSeconds: 0 }],
      [[{ start: 1, end: 2, text: "hola", speaker: "Marta" }]],
    );

    expect(merged[0].speaker).toBe("Marta");
  });

  it("keeps the order across chunks", () => {
    const merged = mergeChunkSegments(
      [{ startSeconds: 0 }, { startSeconds: 100 }],
      [
        [{ start: 0, end: 10, text: "uno" }],
        [{ start: 0, end: 10, text: "dos" }],
      ],
    );

    expect(merged.map((s) => s.start)).toEqual([0, 100]);
  });

  it("tolerates a missing chunk result", () => {
    const merged = mergeChunkSegments(
      [{ startSeconds: 0 }, { startSeconds: 900 }],
      [[{ start: 0, end: 5, text: "solo" }]],
    );

    expect(merged).toHaveLength(1);
  });

  it("returns nothing for no chunks", () => {
    expect(mergeChunkSegments([], [])).toEqual([]);
  });
});
