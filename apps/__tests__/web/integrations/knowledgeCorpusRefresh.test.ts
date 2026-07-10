/// <reference types="bun" />

import { describe, expect, it } from "bun:test";
import { retrieveKnowledgeSnippets } from "../../../web/src/integrations/chat/knowledge/documentRetrieval";
import { CHAT_DOCUMENT_CORPUS } from "../../../web/src/integrations/chat/knowledge/documentCorpus";

// Real union from ChatProvider.ts:29-34 — the only UI actions the chat can promise.
const KNOWN_SUGGESTION_ACTIONS = [
  "view_meetings",
  "view_meeting_detail",
  "install_extension",
  "view_transcription",
  "open_settings",
];

// Meeting status vocabulary (meeting-lifecycle doc) is not a UI action — excluded
// from the anti-drift check below.
const MEETING_LIFECYCLE_VOCAB = ["waiting_admission", "admission_timeout"];

function docIdsForQuery(query: string): string[] {
  return retrieveKnowledgeSnippets(query, { topK: 4 }).map((snippet) => snippet.id);
}

describe("knowledge corpus refresh — retrieval", () => {
  describe("team roles", () => {
    it.each([
      "¿cómo cambio el rol de un compañero?",
      "¿quién puede gestionar el equipo?",
      "soy admin o member?",
    ])("recovers the team-roles doc for %s", (query) => {
      expect(docIdsForQuery(query)).toContain("team-roles");
    });
  });

  it("recovers the auth-gate-login doc for the login redirect query", () => {
    expect(docIdsForQuery("¿por qué me redirigió a login?")).toContain("auth-gate-login");
  });

  describe("database security", () => {
    it.each(["¿mis datos están protegidos?", "¿qué es RLS?"])(
      "recovers the database-security doc for %s",
      (query) => {
        expect(docIdsForQuery(query)).toContain("database-security");
      },
    );
  });

  it("recovers the updated settings-storage doc for a team/service account query", () => {
    expect(docIdsForQuery("¿qué es la cuenta de servicio de Google en Settings?")).toContain(
      "settings-storage",
    );
  });

  it("keeps every snake_case token in the corpus within the real suggestion action union", () => {
    const snakeCaseTokenPattern = /[a-z]+(?:_[a-z]+)+/g;
    const foundTokens = new Set<string>();

    for (const doc of CHAT_DOCUMENT_CORPUS) {
      const matches = doc.content.match(snakeCaseTokenPattern) ?? [];
      for (const token of matches) foundTokens.add(token);
    }

    for (const knownToken of MEETING_LIFECYCLE_VOCAB) {
      foundTokens.delete(knownToken);
    }

    for (const token of foundTokens) {
      expect(KNOWN_SUGGESTION_ACTIONS).toContain(token);
    }
  });
});
