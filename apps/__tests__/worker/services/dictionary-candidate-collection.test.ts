import { afterEach, describe, expect, it, mock } from "bun:test";

const moduleMock = mock as typeof mock & {
  module(specifier: string, factory: () => unknown): void;
  restore(): void;
};

/** Estado simulado de los candidatos persistidos. */
const candidatesState: Array<{ wrong: string; correct: string; hits: number }> = [];

afterEach(() => {
  candidatesState.length = 0;
  moduleMock.restore();
});

function setupRepositoryMock() {
  moduleMock.module("@/repositories/DictionaryCandidateRepository", () => ({
    loadDictionaryCandidates: async () => [...candidatesState],
    saveDictionaryCandidates: async (candidates: Array<{ wrong: string; correct: string; hits: number }>) => {
      candidatesState.length = 0;
      candidatesState.push(...candidates);
    },
  }));
}

describe("accumulateDictionaryCandidates", () => {
  it("detects and persists recurring raw->clean corrections", async () => {
    setupRepositoryMock();

    const raw = [
      "reunión con squads sobre el roadmap",
      "squads confirmó la fecha",
      "squads enviará el informe",
    ].join("\n");
    const clean = [
      "reunión con SQUAADS sobre el roadmap",
      "SQUAADS confirmó la fecha",
      "SQUAADS enviará el informe",
    ].join("\n");

    const { accumulateDictionaryCandidates } = await import(
      `../../../worker/src/services/dictionaryCandidateCollection.ts?test=${Date.now()}`
    );

    const suggestions = await accumulateDictionaryCandidates(raw, clean);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(candidatesState.some((c) => c.wrong === "squads" && c.correct === "squaads")).toBe(true);
  });

  it("accumulates hits across calls for the same pair", async () => {
    setupRepositoryMock();

    const raw = "squads squads";
    const clean = "SQUAADS SQUAADS";

    const { accumulateDictionaryCandidates } = await import(
      `../../../worker/src/services/dictionaryCandidateCollection.ts?test=${Date.now()}`
    );

    await accumulateDictionaryCandidates(raw, clean);
    await accumulateDictionaryCandidates(raw, clean);

    const squads = candidatesState.find((c) => c.wrong === "squads");
    expect(squads?.hits).toBe(4);
  });

  it("does not persist when there are no suggestions", async () => {
    setupRepositoryMock();

    const { accumulateDictionaryCandidates } = await import(
      `../../../worker/src/services/dictionaryCandidateCollection.ts?test=${Date.now()}`
    );

    const suggestions = await accumulateDictionaryCandidates(
      "todo correcto sin errores",
      "todo correcto sin errores",
    );
    expect(suggestions).toEqual([]);
    expect(candidatesState).toEqual([]);
  });
});
