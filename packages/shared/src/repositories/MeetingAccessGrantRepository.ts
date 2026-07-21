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
