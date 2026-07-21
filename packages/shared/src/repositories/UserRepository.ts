import { db } from "@meeting-bot/shared/db";
import { users } from "@meeting-bot/shared/db/schema";
import { eq } from "drizzle-orm";

export class UserRepository {
  // Used by /api/bot/start's machine-to-machine ownerEmail resolution (no
  // session exists on that route) — see spec/features/009-meeting-ownership-sharing/plan.md.
  static async findByEmail(email: string) {
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return user || null;
  }
}
