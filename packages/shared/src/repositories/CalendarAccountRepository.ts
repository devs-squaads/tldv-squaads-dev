import { db } from "@meeting-bot/shared/db";
import { users } from "@meeting-bot/shared/db/schema";
import { eq } from "drizzle-orm";

export class CalendarAccountRepository {
  static async findByEmail(email: string) {
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return user || null;
  }

  static async updateTokens(userId: string, tokens: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
  }) {
    const updateData: Record<string, unknown> = {
      googleAccessToken: tokens.accessToken,
      updatedAt: new Date(),
    };

    if (tokens.refreshToken) {
      updateData.googleRefreshToken = tokens.refreshToken;
    }

    if (tokens.expiresAt) {
      updateData.googleTokenExpiry = new Date(tokens.expiresAt * 1000);
    }

    await db.update(users).set(updateData).where(eq(users.id, userId));
  }

  static async getCalendarEnabledUsers() {
    return db.select().from(users).where(eq(users.calendarEnabled, true));
  }

  static async setCalendarEnabled(userId: string, enabled: boolean) {
    await db.update(users).set({
      calendarEnabled: enabled,
      updatedAt: new Date(),
    }).where(eq(users.id, userId));
  }
}
