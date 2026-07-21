import { db } from "@meeting-bot/shared/db";
import { meetings } from "@meeting-bot/shared/db/schema";
import { and, eq, gte, inArray, isNotNull } from "drizzle-orm";
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

  /**
   * Atomically inserts a meeting keyed by (sourceProvider, sourceEventId), relying on the
   * partial unique index. On conflict (event already enqueued by a concurrent poll), re-fetches
   * and returns the existing winner instead of inserting a duplicate row.
   */
  static async insertDedupedBySourceEvent(values: MeetingInsert): Promise<MeetingRecord> {
    const [inserted] = await db
      .insert(meetings)
      .values(values)
      .onConflictDoNothing({
        target: [meetings.sourceProvider, meetings.sourceEventId],
        where: isNotNull(meetings.sourceEventId), // mirrors the partial index predicate
      })
      .returning();

    if (inserted) return inserted;

    const existing = await MeetingRepository.findBySourceEvent(
      values.sourceProvider as string,
      values.sourceEventId as string,
    );
    if (!existing) {
      throw new Error(
        `insertDedupedBySourceEvent: conflict reported but no existing row found for ${values.sourceProvider}/${values.sourceEventId}`,
      );
    }
    return existing;
  }

  static async updateById(id: string, values: MeetingUpdate): Promise<void> {
    await db.update(meetings).set(values).where(eq(meetings.id, id));
  }
}
