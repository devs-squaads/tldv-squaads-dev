import { db } from "@meeting-bot/shared/db";
import { meetingShareAccessLogs, meetingShares, shareTypeEnum } from "@meeting-bot/shared/db/schema";
import { and, desc, eq, gt, inArray, isNotNull, isNull, lte, or } from "drizzle-orm";

export type ShareType = (typeof shareTypeEnum.enumValues)[number];
export type MeetingShareRecord = typeof meetingShares.$inferSelect;
export type MeetingShareInsert = typeof meetingShares.$inferInsert;
export type MeetingShareUpdate = Partial<Omit<MeetingShareInsert, "id">>;
export type MeetingShareAccessLogInsert = typeof meetingShareAccessLogs.$inferInsert;

export class MeetingShareRepository {
  static async create(values: MeetingShareInsert): Promise<void> {
    await db.insert(meetingShares).values(values);
  }

  static async findById(id: string): Promise<MeetingShareRecord | null> {
    const [share] = await db.select().from(meetingShares).where(eq(meetingShares.id, id)).limit(1);
    return share ?? null;
  }

  static async listByMeetingId(meetingId: string): Promise<MeetingShareRecord[]> {
    return db
      .select()
      .from(meetingShares)
      .where(eq(meetingShares.meetingId, meetingId))
      .orderBy(desc(meetingShares.createdAt));
  }

  static async findByTokenHash(tokenHash: string): Promise<MeetingShareRecord | null> {
    const [share] = await db.select().from(meetingShares).where(eq(meetingShares.tokenHash, tokenHash)).limit(1);
    return share ?? null;
  }

  static async findActiveByTokenHash(tokenHash: string, now: Date = new Date()): Promise<MeetingShareRecord | null> {
    const [share] = await db
      .select()
      .from(meetingShares)
      .where(
        and(
          eq(meetingShares.tokenHash, tokenHash),
          isNull(meetingShares.revokedAt),
          or(isNull(meetingShares.expiresAt), gt(meetingShares.expiresAt, now))
        )
      )
      .limit(1);

    return share ?? null;
  }

  static async findActiveByMeetingAndType(
    meetingId: string,
    shareType: ShareType,
    now: Date = new Date()
  ): Promise<MeetingShareRecord | null> {
    const [share] = await db
      .select()
      .from(meetingShares)
      .where(
        and(
          eq(meetingShares.meetingId, meetingId),
          eq(meetingShares.shareType, shareType),
          isNull(meetingShares.revokedAt),
          or(isNull(meetingShares.expiresAt), gt(meetingShares.expiresAt, now))
        )
      )
      .orderBy(desc(meetingShares.createdAt))
      .limit(1);

    return share ?? null;
  }

  static async updateById(id: string, values: MeetingShareUpdate): Promise<void> {
    await db.update(meetingShares).set(values).where(eq(meetingShares.id, id));
  }

  static async revokeById(id: string, when: Date = new Date()): Promise<void> {
    await db
      .update(meetingShares)
      .set({
        revokedAt: when,
        updatedAt: when,
      })
      .where(eq(meetingShares.id, id));
  }

  static async revokeActiveByMeetingAndType(
    meetingId: string,
    shareType: ShareType,
    when: Date = new Date()
  ): Promise<void> {
    await db
      .update(meetingShares)
      .set({
        revokedAt: when,
        updatedAt: when,
      })
      .where(
        and(
          eq(meetingShares.meetingId, meetingId),
          eq(meetingShares.shareType, shareType),
          isNull(meetingShares.revokedAt)
        )
      );
  }

  static async rotateToken(id: string, tokenHash: string, updatedAt: Date = new Date()): Promise<void> {
    await db
      .update(meetingShares)
      .set({
        tokenHash,
        otpHash: null,
        otpExpiresAt: null,
        updatedAt,
      })
      .where(eq(meetingShares.id, id));
  }

  static async setOtp(id: string, otpHash: string, otpExpiresAt: Date, updatedAt: Date = new Date()): Promise<void> {
    await db
      .update(meetingShares)
      .set({
        otpHash,
        otpExpiresAt,
        updatedAt,
      })
      .where(eq(meetingShares.id, id));
  }

  static async clearOtp(id: string, updatedAt: Date = new Date()): Promise<void> {
    await db
      .update(meetingShares)
      .set({
        otpHash: null,
        otpExpiresAt: null,
        updatedAt,
      })
      .where(eq(meetingShares.id, id));
  }

  static async markAccessed(id: string, when: Date = new Date()): Promise<void> {
    await db
      .update(meetingShares)
      .set({
        lastAccessedAt: when,
        updatedAt: when,
      })
      .where(eq(meetingShares.id, id));
  }

  static async insertAccessLog(values: MeetingShareAccessLogInsert): Promise<void> {
    await db.insert(meetingShareAccessLogs).values(values);
  }

  static async deleteById(id: string): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(meetingShareAccessLogs).where(eq(meetingShareAccessLogs.meetingShareId, id));
      await tx.delete(meetingShares).where(eq(meetingShares.id, id));
    });
  }

  static async deleteInactiveByMeetingId(meetingId: string, now: Date = new Date()): Promise<number> {
    return db.transaction(async (tx) => {
      const inactiveShares = await tx
        .select({ id: meetingShares.id })
        .from(meetingShares)
        .where(
          and(
            eq(meetingShares.meetingId, meetingId),
            or(
              isNotNull(meetingShares.revokedAt),
              and(isNotNull(meetingShares.expiresAt), lte(meetingShares.expiresAt, now))
            )
          )
        );

      const ids = inactiveShares.map((share) => share.id);
      if (ids.length === 0) return 0;

      await tx
        .delete(meetingShareAccessLogs)
        .where(inArray(meetingShareAccessLogs.meetingShareId, ids));

      const deleted = await tx
        .delete(meetingShares)
        .where(inArray(meetingShares.id, ids))
        .returning({ id: meetingShares.id });

      return deleted.length;
    });
  }
}
