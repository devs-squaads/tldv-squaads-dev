/// <reference types="bun" />

import { describe, expect, it } from "bun:test";

import { normalizeLiveServerMessage } from "../../../../../web/src/modules/chat/voice/liveEvents";

describe("normalizeLiveServerMessage", () => {
  it("normaliza setupComplete", () => {
    expect(normalizeLiveServerMessage({ setupComplete: {} })).toEqual([{ type: "setup-complete" }]);
  });

  it("normaliza el audio PCM 24 kHz de modelTurn.parts[].inlineData", () => {
    const events = normalizeLiveServerMessage({
      serverContent: {
        modelTurn: {
          parts: [
            { inlineData: { mimeType: "audio/pcm;rate=24000", data: "QUJD" } },
          ],
        },
      },
    });

    expect(events).toEqual([
      { type: "audio", data: "QUJD", mimeType: "audio/pcm;rate=24000" },
    ]);
  });

  it("normaliza la transcripción de entrada y de salida", () => {
    expect(
      normalizeLiveServerMessage({ serverContent: { inputTranscription: { text: "hola" } } }),
    ).toEqual([{ type: "input-transcript", text: "hola" }]);

    expect(
      normalizeLiveServerMessage({ serverContent: { outputTranscription: { text: "buenas" } } }),
    ).toEqual([{ type: "output-transcript", text: "buenas" }]);
  });

  it("normaliza interrupted solo cuando es verdadero", () => {
    expect(normalizeLiveServerMessage({ serverContent: { interrupted: true } })).toEqual([
      { type: "interrupted" },
    ]);
    expect(normalizeLiveServerMessage({ serverContent: { interrupted: false } })).toEqual([]);
  });

  it("ignora mensajes vacíos {} (verificado: llegan ~14 por turno)", () => {
    expect(normalizeLiveServerMessage({})).toEqual([]);
    expect(normalizeLiveServerMessage("{}")).toEqual([]);
  });

  it("reconoce generationComplete y usageMetadata sin romper ni emitir eventos", () => {
    expect(
      normalizeLiveServerMessage({
        serverContent: { generationComplete: true, usageMetadata: { totalTokenCount: 12 } },
      }),
    ).toEqual([]);
    expect(normalizeLiveServerMessage({ usageMetadata: { totalTokenCount: 12 } })).toEqual([]);
  });

  it("normaliza turnComplete", () => {
    expect(normalizeLiveServerMessage({ serverContent: { turnComplete: true } })).toEqual([
      { type: "turn-complete" },
    ]);
  });

  it("produce varios eventos desde un mismo mensaje, en orden auditable", () => {
    const events = normalizeLiveServerMessage({
      serverContent: {
        modelTurn: {
          parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: "QUJD" } }],
        },
        outputTranscription: { text: "listo" },
        turnComplete: true,
      },
    });

    expect(events.map((event) => event.type)).toEqual([
      "audio",
      "output-transcript",
      "turn-complete",
    ]);
  });

  it("normaliza toolCall.functionCalls", () => {
    const events = normalizeLiveServerMessage({
      toolCall: {
        functionCalls: [
          { id: "call-1", name: "search_meetings", args: { query: "martes" } },
        ],
      },
    });

    expect(events).toEqual([
      {
        type: "tool-call",
        functionCalls: [{ id: "call-1", name: "search_meetings", args: { query: "martes" } }],
      },
    ]);
  });

  it("normaliza toolCallCancellation", () => {
    expect(normalizeLiveServerMessage({ toolCallCancellation: { ids: ["call-1", "call-2"] } })).toEqual([
      { type: "tool-cancellation", ids: ["call-1", "call-2"] },
    ]);
  });

  it("normaliza sessionResumptionUpdate", () => {
    expect(
      normalizeLiveServerMessage({
        sessionResumptionUpdate: { resumable: true, newHandle: "handle-1" },
      }),
    ).toEqual([{ type: "resumption-update", resumable: true, newHandle: "handle-1" }]);

    expect(
      normalizeLiveServerMessage({ sessionResumptionUpdate: { resumable: false } }),
    ).toEqual([{ type: "resumption-update", resumable: false }]);
  });

  it("normaliza goAway con y sin timeLeft", () => {
    expect(normalizeLiveServerMessage({ goAway: { timeLeft: "10s" } })).toEqual([
      { type: "go-away", timeLeft: "10s" },
    ]);
    expect(normalizeLiveServerMessage({ goAway: {} })).toEqual([{ type: "go-away" }]);
  });

  it("normaliza error en sus dos formas conocidas", () => {
    expect(normalizeLiveServerMessage({ error: { message: "boom", code: 500 } })).toEqual([
      { type: "error", message: "boom" },
    ]);
    expect(normalizeLiveServerMessage({ error: "boom" })).toEqual([
      { type: "error", message: "boom" },
    ]);
  });

  it("devuelve unknown para entradas inválidas, sin lanzar nunca", () => {
    const invalidInputs: unknown[] = [
      null,
      undefined,
      42,
      "no-es-json",
      [],
      { serverContent: "no-es-objeto" },
      { cualquierCosa: true },
    ];

    for (const input of invalidInputs) {
      expect(normalizeLiveServerMessage(input)).toEqual([{ type: "unknown" }]);
    }
  });

  it("acepta el frame crudo como string JSON", () => {
    expect(normalizeLiveServerMessage('{"setupComplete":{}}')).toEqual([{ type: "setup-complete" }]);
  });
});
