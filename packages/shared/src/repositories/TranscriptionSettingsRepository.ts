import { db } from "@meeting-bot/shared/db";
import { settings } from "@meeting-bot/shared/db/schema";
import { eq } from "drizzle-orm";

export const TRANSCRIPTION_CONTEXT_KEY = "transcription_context";
export const TRANSCRIPTION_DICTIONARY_KEY = "transcription_dictionary";

export class TranscriptionSettingsRepository {
  static async get() {
    const [contextSetting, dictionarySetting] = await Promise.all([
      db.select().from(settings).where(eq(settings.key, TRANSCRIPTION_CONTEXT_KEY)).limit(1),
      db.select().from(settings).where(eq(settings.key, TRANSCRIPTION_DICTIONARY_KEY)).limit(1),
    ]);

    return {
      context: contextSetting[0]?.value ?? null,
      dictionary: dictionarySetting[0]?.value ?? null,
    };
  }

  static async save(input: {
    context: string;
    dictionary: string;
  }): Promise<void> {
    const entries = [
      [TRANSCRIPTION_CONTEXT_KEY, input.context],
      [TRANSCRIPTION_DICTIONARY_KEY, input.dictionary],
    ] as const;

    for (const [key, value] of entries) {
      const [existing] = await db.select().from(settings).where(eq(settings.key, key)).limit(1);

      if (existing) {
        await db.update(settings).set({ value }).where(eq(settings.key, key));
      } else {
        await db.insert(settings).values({ key, value });
      }
    }
  }
}
