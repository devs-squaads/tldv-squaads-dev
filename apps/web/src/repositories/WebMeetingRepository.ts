import { db } from "@meeting-bot/shared/db";
import { meetings } from "@meeting-bot/shared/db/schema";
import { and, desc, eq, gte, ilike, lte, or } from "drizzle-orm";
import type { MeetingRecord } from "@meeting-bot/shared/repositories/MeetingRepository";
import type { MeetingStatus } from "@meeting-bot/shared/domain/meetingStatus";

export interface MeetingFilters {
  status?: string;
  from_date?: string;
  to_date?: string;
  query?: string;
  limit?: number;
}

export class WebMeetingRepository {
  static async listRecent(): Promise<MeetingRecord[]> {
    return db.select().from(meetings).orderBy(desc(meetings.createdAt));
  }

  /**
   * Filtra reuniones directamente en SQL — más eficiente y preciso que
   * traer todo con listRecent() y filtrar en memoria.
   */
  static async listFiltered(filters: MeetingFilters): Promise<MeetingRecord[]> {
    const { status, from_date, to_date, query, limit = 50 } = filters;

    const result = await db
      .select()
      .from(meetings)
      .where(
        and(
          status ? eq(meetings.status, status as MeetingStatus) : undefined,
          from_date ? gte(meetings.createdAt, new Date(from_date)) : undefined,
          to_date ? lte(meetings.createdAt, new Date(to_date)) : undefined,
          query
            ? or(
                ilike(meetings.name, `%${query}%`),
                ilike(meetings.url, `%${query}%`),
                ilike(meetings.botName, `%${query}%`),
              )
            : undefined,
        ),
      )
      .orderBy(desc(meetings.createdAt))
      .limit(Math.min(limit, 50));

    return result;
  }

  static async deleteById(id: string): Promise<void> {
    await db.delete(meetings).where(eq(meetings.id, id));
  }
}
