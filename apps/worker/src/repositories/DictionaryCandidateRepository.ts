import { db } from "@meeting-bot/shared/db";
import { settings } from "@meeting-bot/shared/db/schema";
import { eq } from "drizzle-orm";
import type { CandidateCount } from "@meeting-bot/shared/services/dictionaryRefinement";

export const DICTIONARY_CANDIDATES_KEY = "transcription_dictionary_candidates";

const MAX_CANDIDATES = 200;

/** Lee los candidatos acumulados (JSON en settings). [] si no hay. */
export async function loadDictionaryCandidates(): Promise<CandidateCount[]> {
  const [row] = await db.select().from(settings).where(eq(settings.key, DICTIONARY_CANDIDATES_KEY)).limit(1);

  const raw = row?.value ?? null;
  if (!raw) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(
        (entry): entry is CandidateCount =>
          typeof entry === "object" &&
          entry !== null &&
          typeof (entry as CandidateCount).wrong === "string" &&
          typeof (entry as CandidateCount).correct === "string" &&
          typeof (entry as CandidateCount).hits === "number",
      )
      .slice(0, MAX_CANDIDATES);
  } catch {
    return [];
  }
}

/** Persiste los candidatos (capa MAX_CANDIDATES). */
export async function saveDictionaryCandidates(candidates: CandidateCount[]): Promise<void> {
  const value = JSON.stringify(candidates.slice(0, MAX_CANDIDATES));
  const [existing] = await db.select().from(settings).where(eq(settings.key, DICTIONARY_CANDIDATES_KEY)).limit(1);

  if (existing) {
    await db.update(settings).set({ value }).where(eq(settings.key, DICTIONARY_CANDIDATES_KEY));
  } else {
    await db.insert(settings).values({ key: DICTIONARY_CANDIDATES_KEY, value });
  }
}

/** Vacía los candidatos (tras promoverlos con --commit). */
export async function clearDictionaryCandidates(): Promise<void> {
  await db.delete(settings).where(eq(settings.key, DICTIONARY_CANDIDATES_KEY));
}
