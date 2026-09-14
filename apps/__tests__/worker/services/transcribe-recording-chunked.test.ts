/// <reference types="bun" />

import { afterEach, describe, expect, it, mock } from "bun:test";

const moduleMock = mock as typeof mock & {
  module(specifier: string, factory: () => unknown): void;
  restore(): void;
};

afterEach(() => {
  moduleMock.restore();
});

interface HarnessOptions {
  /** Proveedor con `transcribeDetailed` (segmentos) o sólo `transcribe` (texto plano). */
  providerKind: "detailed" | "text-only";
  chunkCount: number;
}

/**
 * Cubre el camino troceado con un proveedor que sólo implementa `transcribe`.
 *
 * Regresión que detectó la revisión de frontera: `runProvider` devolvía `{ text, segments: [] }` y la
 * fusión trabajaba sólo sobre segmentos, así que una reunión larga con ese proveedor se quedaba con
 * el texto vacío.
 */
function setupHarness(options: HarnessOptions) {
  const chunks = Array.from({ length: options.chunkCount }, (_, i) => ({
    index: i,
    startSeconds: i * 10,
    durationSeconds: 10,
  }));

  const provider =
    options.providerKind === "detailed"
      ? {
          name: "fake-detailed",
          transcribe: async () => "",
          transcribeDetailed: async (file: string) => ({
            text: `segmentos de ${file}`,
            segments: [{ start: 0, end: 5, text: `texto de ${file}` }],
            durationSeconds: 10,
          }),
        }
      : {
          name: "fake-text-only",
          transcribe: async (file: string) => `texto plano de ${file}`,
        };

  moduleMock.module("@/services/audioPreprocessing", () => ({
    prepareTranscriptionAudio: async () => ({
      files: chunks.map((c) => `/tmp/chunk-${c.index}.ogg`),
      chunks,
      durationSeconds: options.chunkCount * 10,
      cleanup: () => undefined,
    }),
  }));

  moduleMock.module("@/integrations/ai/transcription/TranscriptionProviderFactory", () => ({
    TranscriptionProviderFactory: {
      getProvider: () => provider,
      isConfigured: () => true,
    },
  }));

  moduleMock.module("@/services/speakerAttribution", () => ({
    isSpeakerAttributionEnabled: () => false,
    attributeSpeakersToSegments: async (segments: unknown[]) => segments,
  }));

  return {
    importService: () =>
      import(`../../../worker/src/services/meetingAiProcessingService.ts?test=${Date.now()}`),
  };
}

describe("transcribeRecording con audio troceado (spec 016)", () => {
  it("conserva el texto de un proveedor que sólo implementa transcribe", async () => {
    const harness = setupHarness({ providerKind: "text-only", chunkCount: 3 });
    const { transcribeRecording } = await harness.importService();

    const result = await transcribeRecording("/tmp/meeting.mp4");

    expect(result.segments).toEqual([]);
    expect(result.text).toContain("texto plano de /tmp/chunk-0.ogg");
    expect(result.text).toContain("texto plano de /tmp/chunk-1.ogg");
    expect(result.text).toContain("texto plano de /tmp/chunk-2.ogg");
    expect(result.durationSeconds).toBe(30);
  });

  it("fusiona con desplazamiento cuando el proveedor sí devuelve segmentos", async () => {
    const harness = setupHarness({ providerKind: "detailed", chunkCount: 3 });
    const { transcribeRecording } = await harness.importService();

    const result = await transcribeRecording("/tmp/meeting.mp4");

    expect(result.segments).toHaveLength(3);
    expect(result.segments.map((s) => s.start)).toEqual([0, 10, 20]);
    expect(result.segments[0].text).toBe("texto de /tmp/chunk-0.ogg");
  });

  it("no pierde ningún fragmento en el camino de texto plano", async () => {
    const harness = setupHarness({ providerKind: "text-only", chunkCount: 5 });
    const { transcribeRecording } = await harness.importService();

    const result = await transcribeRecording("/tmp/meeting.mp4");

    expect(result.text.split("\n")).toHaveLength(5);
  });
});
