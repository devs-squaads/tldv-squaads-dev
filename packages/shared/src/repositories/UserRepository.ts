import { db } from "@meeting-bot/shared/db";
import { users } from "@meeting-bot/shared/db/schema";
import { eq, inArray } from "drizzle-orm";

export class UserRepository {
  // Used by /api/bot/start's machine-to-machine ownerEmail resolution (no
  // session exists on that route) — see spec/features/009-meeting-ownership-sharing/plan.md.
  static async findByEmail(email: string) {
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return user || null;
  }

  // 013: batch resolver for display purposes (grantee/requester email lookups on the sharing
  // views) — avoids an N+1 lookup per row. Empty input short-circuits (an empty `inArray` is
  // still a valid query, but skipping the round-trip is free).
  static async findByIds(ids: string[]): Promise<Array<{ id: string; email: string }>> {
    if (ids.length === 0) return [];
    return db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, ids));
  }
}
