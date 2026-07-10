import { db } from "@meeting-bot/shared/db";
import { meetings } from "@meeting-bot/shared/db/schema";
import { and, eq, gte, inArray } from "drizzle-orm";
import { ACTIVE_PROCESSING_STATUSES, type MeetingStatus } from "@meeting-bot/shared/domain/meetingStatus";

export type MeetingRecord = typeof meetings.$inferSelect;
export type MeetingInsert = typeof meetings.$inferInsert;
export type MeetingUpdate = Partial<Omit<MeetingInsert, "id">>;

export class MeetingRepository {
  static async findById(id: string): Promise<MeetingRecord | null> {
    const [meeting] = await db.select().from(meetings).where(eq(meetings.id, id)).limit(1);
    return meeting ?? null;
  }

  static async findByUrlCreatedAfter(url: string, from: Date): Promise<MeetingRecord | null> {
    const [meeting] = await db
      .select()
      .from(meetings)
      .where(and(eq(meetings.url, url), gte(meetings.createdAt, from)))
      .limit(1);

    return meeting ?? null;
  }

  static async findActiveByUrlCreatedAfter(url: string, from: Date): Promise<MeetingRecord | null> {
    const [meeting] = await db
      .select()
      .from(meetings)
      .where(
        and(
          eq(meetings.url, url),
          inArray(meetings.status, ACTIVE_PROCESSING_STATUSES as Array<MeetingStatus>),
          gte(meetings.createdAt, from)
        )
      )
      .limit(1);

    return meeting ?? null;
  }

  static async findBySourceEvent(sourceProvider: string, sourceEventId: string): Promise<MeetingRecord | null> {
    const [meeting] = await db
      .select()
      .from(meetings)
      .where(and(eq(meetings.sourceProvider, sourceProvider), eq(meetings.sourceEventId, sourceEventId)))
      .limit(1);

    return meeting ?? null;
  }

  static async insert(values: MeetingInsert): Promise<void> {
    await db.insert(meetings).values(values);
  }

  static async updateById(id: string, values: MeetingUpdate): Promise<void> {
    await db.update(meetings).set(values).where(eq(meetings.id, id));
  }
}
