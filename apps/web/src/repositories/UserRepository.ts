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

  /**
   * Persists the identity side of a login only.
   *
   * The `google_access_token` / `google_refresh_token` / `google_token_expiry`
   * columns are deliberately NOT written here: login requests identity scopes
   * only (`openid email profile`), so writing its token would downgrade the
   * `calendar.readonly` grant stored by the calendar-connect flow and leave the
   * worker's calendar poller on 403 insufficient_scope. Those columns have a
   * single owner — `CalendarAccountRepository.updateTokens`, called from
   * `/api/settings/calendar-connect/callback`.
   *
   * The login token itself is not lost: it lives on the NextAuth JWT.
   */
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

    const existing = await this.findByEmail(profile.email);

    if (existing) {
      const updateData = {
        name: profile.name,
        image: profile.image,
        updatedAt: now,
      };

      await db.update(users).set(updateData).where(eq(users.id, existing.id));
      return { ...existing, ...updateData };
    }

    const newUser = {
      id: profile.id,
      name: profile.name,
      email: profile.email,
      image: profile.image,
      calendarEnabled: false, // Calendar is now a separate opt-in step from Settings
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(users).values(newUser);
    return newUser;
  }
}
