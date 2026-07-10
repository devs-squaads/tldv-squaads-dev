import { db } from "@meeting-bot/shared/db";
import { settings } from "@meeting-bot/shared/db/schema";
import { eq } from "drizzle-orm";

export type SettingRecord = typeof settings.$inferSelect;

export class WebSettingsRepository {
  static async list(): Promise<SettingRecord[]> {
    return db.select().from(settings);
  }

  static async getValue(key: string): Promise<string | null> {
    const [setting] = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
    return setting?.value ?? null;
  }

  static async toRecord(): Promise<Record<string, string>> {
    const allSettings = await this.list();
    return allSettings.reduce((acc, curr) => {
      acc[curr.key] = curr.value || "";
      return acc;
    }, {} as Record<string, string>);
  }

  static async upsertMany(data: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(data)) {
      const [existing] = await db.select().from(settings).where(eq(settings.key, key)).limit(1);

      if (existing) {
        await db.update(settings).set({ value: String(value ?? "") }).where(eq(settings.key, key));
      } else {
        await db.insert(settings).values({ key, value: String(value ?? "") });
      }
    }
  }
}
