import { describe, expect, it, mock, beforeEach } from "bun:test";

type UserRow = { id: string; email: string };

const state: { usersByEmail: Record<string, UserRow> } = { usersByEmail: {} };

function resetState() {
  state.usersByEmail = {};
}

const bunMock = mock as typeof mock & {
  module: (specifier: string, factory: () => unknown) => void;
};

bunMock.module("@meeting-bot/shared/repositories/UserRepository", () => ({
  UserRepository: {
    findByEmail: async (email: string) => state.usersByEmail[email.toLowerCase()] ?? null,
    // Stubbed to keep this process-wide mock.module() registration (first-registration-wins,
    // see apps/__tests__/shared/repositories/user-repository.test.ts) satisfying the real
    // UserRepository interface for any other test file that transitively depends on it.
    findByIds: async () => [],
  },
}));

const { ParticipantSuggestionService } = await import(
  "../../../web/src/services/participantSuggestionService"
);

describe("ParticipantSuggestionService.resolveSuggestions", () => {
  beforeEach(() => {
    resetState();
    state.usersByEmail["registered@example.com"] = { id: "user-1", email: "registered@example.com" };
  });

  it("returns an empty list for ad-hoc meetings (null/empty participantEmails)", async () => {
    expect(await ParticipantSuggestionService.resolveSuggestions(null)).toEqual([]);
    expect(await ParticipantSuggestionService.resolveSuggestions(undefined)).toEqual([]);
    expect(await ParticipantSuggestionService.resolveSuggestions([])).toEqual([]);
  });

  it("resolves a registered participant to the Access Grant flow (granteeUserId set)", async () => {
    const result = await ParticipantSuggestionService.resolveSuggestions(["registered@example.com"]);

    expect(result).toEqual([
      { email: "registered@example.com", granteeUserId: "user-1" },
    ]);
  });

  it("falls back to the restricted_email share flow for an unregistered participant (granteeUserId null)", async () => {
    const result = await ParticipantSuggestionService.resolveSuggestions(["stranger@example.com"]);

    expect(result).toEqual([
      { email: "stranger@example.com", granteeUserId: null },
    ]);
  });

  it("resolves a mixed list independently per participant", async () => {
    const result = await ParticipantSuggestionService.resolveSuggestions([
      "registered@example.com",
      "stranger@example.com",
    ]);

    expect(result).toEqual([
      { email: "registered@example.com", granteeUserId: "user-1" },
      { email: "stranger@example.com", granteeUserId: null },
    ]);
  });
});
