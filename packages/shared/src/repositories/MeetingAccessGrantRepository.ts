import { db } from "@meeting-bot/shared/db";
import { meetingAccessGrants } from "@meeting-bot/shared/db/schema";
import { and, desc, eq, gt, isNull, or } from "drizzle-orm";

export type MeetingAccessGrantRecord = typeof meetingAccessGrants.$inferSelect;
export type MeetingAccessGrantInsert = typeof meetingAccessGrants.$inferInsert;

export class MeetingAccessGrantRepository {
  static async create(values: MeetingAccessGrantInsert): Promise<void> {
    await db.insert(meetingAccessGrants).values(values);
  }

  static async findById(id: string): Promise<MeetingAccessGrantRecord | null> {
    const [grant] = await db.select().from(meetingAccessGrants).where(eq(meetingAccessGrants.id, id)).limit(1);
    return grant ?? null;
  }

  static async listByMeetingId(meetingId: string): Promise<MeetingAccessGrantRecord[]> {
    return db
      .select()
      .from(meetingAccessGrants)
      .where(eq(meetingAccessGrants.meetingId, meetingId))
      .orderBy(desc(meetingAccessGrants.createdAt));
  }

  /**
   * Idempotency guard: matches ANY row for the pair regardless of `revokedAt`/`expiresAt` — a
   * manually revoked grant must never be silently re-created by a later auto-join poll. Contrast
   * with `findLiveGrant` below, which only matches currently-active (non-revoked, non-expired) grants.
   */
  static async existsForMeetingAndGrantee(meetingId: string, granteeUserId: string): Promise<boolean> {
    const [row] = await db
      .select({ id: meetingAccessGrants.id })
      .from(meetingAccessGrants)
      .where(and(eq(meetingAccessGrants.meetingId, meetingId), eq(meetingAccessGrants.granteeUserId, granteeUserId)))
      .limit(1);
    return Boolean(row);
  }

  /**
   * Atomically inserts a grant keyed by (meetingId, granteeUserId), relying on the unconditional
   * unique index on that pair. On conflict (a concurrent poll already created — or a revoked —
   * grant for this pair), re-fetches and returns the existing row instead of inserting a duplicate.
   * The DB constraint is the actual source of truth; `existsForMeetingAndGrantee` is only a
   * fast-path optimization to skip an unnecessary insert attempt.
   */
  static async createDedupedForMeetingAndGrantee(
    values: MeetingAccessGrantInsert
  ): Promise<MeetingAccessGrantRecord> {
    const [inserted] = await db
      .insert(meetingAccessGrants)
      .values(values)
      .onConflictDoNothing({
        target: [meetingAccessGrants.meetingId, meetingAccessGrants.granteeUserId],
      })
      .returning();

    if (inserted) return inserted;

    const [existing] = await db
      .select()
      .from(meetingAccessGrants)
      .where(
        and(
          eq(meetingAccessGrants.meetingId, values.meetingId as string),
          eq(meetingAccessGrants.granteeUserId, values.granteeUserId as string),
        ),
      )
      .limit(1);
    if (!existing) {
      throw new Error(
        `createDedupedForMeetingAndGrantee: conflict reported but no existing row found for ${values.meetingId}/${values.granteeUserId}`,
      );
    }
    return existing;
  }

  /**
   * Upsert for the manual "grant access" flow (Settings/dashboard share panel). The unique
   * index on (meetingId, granteeUserId) is unconditional, so a plain `create()` crashes if any
   * row already exists for the pair — active OR revoked. This re-activates in place instead:
   * un-revokes and refreshes expiresAt/updatedAt on conflict. Contrast with
   * `createDedupedForMeetingAndGrantee`, which is fire-and-forget for the auto-join path and
   * deliberately leaves a revoked row alone.
   */
  static async upsertActive(values: MeetingAccessGrantInsert): Promise<MeetingAccessGrantRecord> {
    const [row] = await db
      .insert(meetingAccessGrants)
      .values(values)
      .onConflictDoUpdate({
        target: [meetingAccessGrants.meetingId, meetingAccessGrants.granteeUserId],
        set: {
          revokedAt: null,
          expiresAt: values.expiresAt ?? null,
          updatedAt: values.updatedAt,
        },
      })
      .returning();
    return row;
  }

  static async findLiveGrant(
    meetingId: string,
    granteeUserId: string,
    now: Date = new Date()
  ): Promise<MeetingAccessGrantRecord | null> {
    const [grant] = await db
      .select()
      .from(meetingAccessGrants)
      .where(
        and(
          eq(meetingAccessGrants.meetingId, meetingId),
          eq(meetingAccessGrants.granteeUserId, granteeUserId),
          isNull(meetingAccessGrants.revokedAt),
          or(isNull(meetingAccessGrants.expiresAt), gt(meetingAccessGrants.expiresAt, now))
        )
      )
      .limit(1);

    return grant ?? null;
  }

  static async revokeById(id: string, when: Date = new Date()): Promise<void> {
    await db
      .update(meetingAccessGrants)
      .set({
        revokedAt: when,
        updatedAt: when,
      })
      .where(eq(meetingAccessGrants.id, id));
  }
}
