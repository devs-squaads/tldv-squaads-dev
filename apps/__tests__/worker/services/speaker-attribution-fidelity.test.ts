/// <reference types="bun" />

import { describe, expect, it } from "bun:test";
import {
  applyAttributionToChunk,
  chunkLineIndexes,
  chunkLines,
  isAttributionLossy,
  speakerAt,
} from "../../../worker/src/services/speakerAttribution";

describe("chunkLineIndexes (spec 016)", () => {
  it("agrupa las mismas líneas que chunkLines, pero devolviendo índices", () => {
    const lines = ["a".repeat(6), "b".repeat(6), "c".repeat(6)];
    const indexes = chunkLineIndexes(lines, 10);

    expect(indexes).toEqual([[0], [1], [2]]);
    expect(indexes.map((idxs) => idxs.map((i) => lines[i]))).toEqual(chunkLines(lines, 10));
  });

  it("no pierde ni reordena ninguna línea", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `linea-${i}-${"x".repeat(20)}`);
    const flat = chunkLineIndexes(lines, 100).flat();

    expect(flat).toEqual(lines.map((_, i) => i));
  });

  it("respeta el límite de caracteres por chunk", () => {
    const lines = Array.from({ length: 20 }, () => "y".repeat(30));
    const chunks = chunkLineIndexes(lines, 100);

    for (const chunk of chunks) {
      const chars = chunk.reduce((sum, i) => sum + lines[i].length + 1, 0);
      expect(chars).toBeLessThanOrEqual(100);
    }
  });

  it("devuelve vacío para una entrada vacía", () => {
    expect(chunkLineIndexes([], 100)).toEqual([]);
  });
});

describe("isAttributionLossy (spec 016)", () => {
  it("marca como pérdida una respuesta truncada por el proveedor", () => {
    expect(isAttributionLossy(1000, 1000, true)).toBe(true);
  });

  it("marca como pérdida un adelgazamiento por debajo del 70 %", () => {
    expect(isAttributionLossy(1000, 699, false)).toBe(true);
  });

  it("acepta una fusión de líneas razonable", () => {
    // La atribución fusiona turnos del mismo hablante: algo menos de texto es legítimo.
    expect(isAttributionLossy(1000, 800, false)).toBe(false);
  });

  it("acepta el límite exacto del 70 %", () => {
    expect(isAttributionLossy(1000, 700, false)).toBe(false);
  });

  it("trata una entrada sin caracteres como pérdida sólo si tampoco hay salida", () => {
    expect(isAttributionLossy(0, 0, false)).toBe(true);
  });
});

describe("speakerAt (spec 016)", () => {
  const timeline = [
    { speaker: "Ana", start: 0, end: 10, text: "hola" },
    { speaker: "Luis", start: 10, end: 20, text: "buenas" },
    { speaker: "Ana", start: 20, end: 30, text: "vale" },
  ];

  it("devuelve el hablante vigente en ese instante", () => {
    expect(speakerAt(timeline, 5)).toBe("Ana");
    expect(speakerAt(timeline, 15)).toBe("Luis");
    expect(speakerAt(timeline, 25)).toBe("Ana");
  });

  it("mantiene el último hablante conocido dentro de la tolerancia", () => {
    expect(speakerAt(timeline, 31, 3)).toBe("Ana");
  });

  it("devuelve undefined antes de la primera línea", () => {
    expect(speakerAt(timeline, -10, 3)).toBeUndefined();
  });

  it("devuelve undefined con una línea temporal vacía", () => {
    expect(speakerAt([], 5)).toBeUndefined();
  });
});

describe("applyAttributionToChunk (spec 016)", () => {
  const segments = [
    { start: 0, end: 4, text: "uno" },
    { start: 5, end: 9, text: "dos" },
    { start: 60, end: 64, text: "tres" },
  ];

  it("NUNCA descarta un segmento, aunque el modelo no lo cubra", () => {
    // El modelo sólo reemitió la primera mitad: antes esto hacía desaparecer `tres`.
    const result = applyAttributionToChunk(segments, [
      { speaker: "Ana", start: 0, end: 9, text: "uno dos" },
    ]);

    expect(result).toHaveLength(3);
    expect(result.map((s) => s.text)).toEqual(["uno", "dos", "tres"]);
  });

  it("asigna hablante a los segmentos cubiertos", () => {
    const result = applyAttributionToChunk(segments, [
      { speaker: "Ana", start: 0, end: 9, text: "uno dos" },
    ]);

    expect(result[0].speaker).toBe("Ana");
    expect(result[1].speaker).toBe("Ana");
  });

  it("cambia de hablante en el punto que marca la línea temporal", () => {
    const result = applyAttributionToChunk(segments, [
      { speaker: "Ana", start: 0, end: 9, text: "uno dos" },
      { speaker: "Luis", start: 60, end: 64, text: "tres" },
    ]);

    expect(result.map((s) => s.speaker)).toEqual(["Ana", "Ana", "Luis"]);
  });

  it("conserva los segmentos sin hablante cuando no hay línea temporal", () => {
    const result = applyAttributionToChunk(segments, []);

    expect(result).toHaveLength(3);
    expect(result.every((s) => s.speaker === undefined)).toBe(true);
  });

  it("no muta los segmentos de entrada", () => {
    const input = [{ start: 0, end: 4, text: "uno" }];
    const result = applyAttributionToChunk(input, [{ speaker: "Ana", start: 0, end: 4, text: "uno" }]);

    expect(input[0]).not.toHaveProperty("speaker");
    expect(result[0].speaker).toBe("Ana");
  });

  it("tolera una línea temporal desordenada", () => {
    const result = applyAttributionToChunk(segments, [
      { speaker: "Luis", start: 60, end: 64, text: "tres" },
      { speaker: "Ana", start: 0, end: 9, text: "uno dos" },
    ]);

    expect(result.map((s) => s.speaker)).toEqual(["Ana", "Ana", "Luis"]);
  });
});
