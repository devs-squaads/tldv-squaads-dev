import { describe, expect, it } from "bun:test";
import {
  groupWordsIntoTurns,
  extractWords,
  type DeepgramWord,
} from "../../../worker/src/services/deepgram";

describe("groupWordsIntoTurns", () => {
  const words: DeepgramWord[] = [
    { word: "hola", start: 0, end: 0.5, speaker: 0 },
    { word: "buenos", start: 0.6, end: 1.1, speaker: 0 },
    { word: "días", start: 1.2, end: 1.8, speaker: 0 },
    { word: "gracias", start: 2.0, end: 2.6, speaker: 1 },
    { word: "a", start: 2.7, end: 3.0, speaker: 1 },
    { word: "todos", start: 3.1, end: 3.6, speaker: 1 },
  ];

  it("groups consecutive words by speaker into turns", () => {
    const turns = groupWordsIntoTurns(words);
    expect(turns).toHaveLength(2);

    expect(turns[0]).toMatchObject({
      speaker: "Participante 1",
      start: 0,
      end: 1.8,
      text: "hola buenos días",
    });
    expect(turns[1]).toMatchObject({
      speaker: "Participante 2",
      start: 2.0,
      end: 3.6,
      text: "gracias a todos",
    });
  });

  it("splits a turn when the gap between words exceeds the max gap", () => {
    const gapWords: DeepgramWord[] = [
      { word: "primero", start: 0, end: 0.5, speaker: 0 },
      { word: "después", start: 10, end: 10.5, speaker: 0 },
    ];
    const turns = groupWordsIntoTurns(gapWords, 2);
    expect(turns).toHaveLength(2);
  });

  it("returns empty array when no word has a speaker", () => {
    const noSpeaker: DeepgramWord[] = [
      { word: "hola", start: 0, end: 0.5 },
      { word: "mundo", start: 0.6, end: 1.0 },
    ];
    expect(groupWordsIntoTurns(noSpeaker)).toEqual([]);
  });

  it("returns empty array for no words", () => {
    expect(groupWordsIntoTurns([])).toEqual([]);
  });
});

describe("extractWords", () => {
  it("extracts words from a ListenV1Response-shaped object defensively", () => {
    const response = {
      results: {
        channels: [
          {
            alternatives: [
              {
                words: [{ word: "hola", start: 0, end: 0.5, speaker: 0 }],
              },
            ],
          },
        ],
      },
    } as never;

    const words = extractWords(response);
    expect(words).toHaveLength(1);
    expect(words[0]?.speaker).toBe(0);
  });

  it("returns empty array for malformed responses", () => {
    expect(extractWords({} as never)).toEqual([]);
    expect(extractWords({ results: {} } as never)).toEqual([]);
  });
});
