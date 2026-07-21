import { db } from "@meeting-bot/shared/db";
import { authorizedAccounts, meetingAccessGrants, meetings, users } from "@meeting-bot/shared/db/schema";
import { and, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import type { MeetingRecord } from "@meeting-bot/shared/repositories/MeetingRepository";
import type { MeetingStatus } from "@meeting-bot/shared/domain/meetingStatus";

export interface MeetingFilters {
  status?: string;
  from_date?: string;
  to_date?: string;
  query?: string;
  limit?: number;
}

/**
 * Ownership-scoped visibility (spec 009, req. "Ownership-scoped meeting visibility" +
 * "Deactivated Owner lockout"): a meeting is visible to `userId` only if they own it
 * or hold a live (non-revoked, non-expired) Access Grant on it — AND the owner's
 * `authorized_accounts.isActive` is true. No `authorized_accounts.role` bypass exists;
 * this filter is identical for every user regardless of admin/member role.
 */
function visibleToUser(userId: string) {
  return and(
    or(
      eq(meetings.ownerId, userId),
      sql`EXISTS (
        SELECT 1 FROM ${meetingAccessGrants}
        WHERE ${meetingAccessGrants.meetingId} = ${meetings.id}
          AND ${meetingAccessGrants.granteeUserId} = ${userId}
          AND ${meetingAccessGrants.revokedAt} IS NULL
          AND (${meetingAccessGrants.expiresAt} IS NULL OR ${meetingAccessGrants.expiresAt} > now())
      )`,
    ),
    sql`EXISTS (
      SELECT 1 FROM ${authorizedAccounts}
      INNER JOIN ${users} ON ${users.email} = ${authorizedAccounts.email}
      WHERE ${users.id} = ${meetings.ownerId}
        AND ${authorizedAccounts.isActive} = true
    )`,
  );
}

export class WebMeetingRepository {
  static async listRecent(userId: string): Promise<MeetingRecord[]> {
    return db.select().from(meetings).where(visibleToUser(userId)).orderBy(desc(meetings.createdAt));
  }

  /**
   * Filtra reuniones directamente en SQL — más eficiente y preciso que
   * traer todo con listRecent() y filtrar en memoria.
   */
  static async listFiltered(userId: string, filters: MeetingFilters): Promise<MeetingRecord[]> {
    const { status, from_date, to_date, query, limit = 50 } = filters;

    const result = await db
      .select()
      .from(meetings)
      .where(
        and(
          visibleToUser(userId),
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

  /** Ownership-scoped single-meeting lookup, for the meeting detail page. */
  static async findByIdForUser(userId: string, id: string): Promise<MeetingRecord | null> {
    const [meeting] = await db
      .select()
      .from(meetings)
      .where(and(eq(meetings.id, id), visibleToUser(userId)))
      .limit(1);

    return meeting ?? null;
  }

  static async deleteById(id: string): Promise<void> {
    await db.delete(meetings).where(eq(meetings.id, id));
  }
}
