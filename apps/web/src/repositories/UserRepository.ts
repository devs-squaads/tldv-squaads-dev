import { db } from "@meeting-bot/shared/db";
import { users } from "@meeting-bot/shared/db/schema";
import { eq } from "drizzle-orm";

export class UserRepository {
  static async findById(id: string) {
    const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return user || null;
  }

  static async findByEmail(email: string) {
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return user || null;
  }

  static async upsertFromGoogle(profile: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
  }) {
    const now = new Date();
    const tokenExpiry = profile.expiresAt
      ? new Date(profile.expiresAt * 1000)
      : null;

    const existing = await this.findByEmail(profile.email);

    if (existing) {
      const updateData: Record<string, unknown> = {
        name: profile.name,
        image: profile.image,
        googleAccessToken: profile.accessToken,
        updatedAt: now,
      };

      // Only update refresh token if we got a new one
      if (profile.refreshToken) {
        updateData.googleRefreshToken = profile.refreshToken;
      }
      if (tokenExpiry) {
        updateData.googleTokenExpiry = tokenExpiry;
      }

      await db.update(users).set(updateData).where(eq(users.id, existing.id));
      return { ...existing, ...updateData };
    }

    const newUser = {
      id: profile.id,
      name: profile.name,
      email: profile.email,
      image: profile.image,
      googleAccessToken: profile.accessToken,
      googleRefreshToken: profile.refreshToken || null,
      googleTokenExpiry: tokenExpiry,
      calendarEnabled: false, // Calendar is now a separate opt-in step from Settings
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(users).values(newUser);
    return newUser;
  }
}
