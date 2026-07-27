import { db } from "@meeting-bot/shared/db";
import { meetingShareRequests } from "@meeting-bot/shared/db/schema";
import { and, count, desc, eq, ne } from "drizzle-orm";

export type MeetingShareRequestRecord = typeof meetingShareRequests.$inferSelect;
export type MeetingShareRequestInsert = typeof meetingShareRequests.$inferInsert;
export type MeetingShareRequestStatus = MeetingShareRequestRecord["status"];

export interface ResolveShareRequestInput {
  status: Exclude<MeetingShareRequestStatus, "pending">;
  resolvedBy?: string | null;
  resolvedGrantId?: string | null;
  resolvedShareId?: string | null;
  resolvedAt?: Date;
}

export class MeetingShareRequestRepository {
  static async create(values: MeetingShareRequestInsert): Promise<void> {
    await db.insert(meetingShareRequests).values(values);
  }

  static async findById(id: string): Promise<MeetingShareRequestRecord | null> {
    const [request] = await db.select().from(meetingShareRequests).where(eq(meetingShareRequests.id, id)).limit(1);
    return request ?? null;
  }

  static async listPending(): Promise<MeetingShareRequestRecord[]> {
    return db
      .select()
      .from(meetingShareRequests)
      .where(eq(meetingShareRequests.status, "pending"))
      .orderBy(desc(meetingShareRequests.createdAt));
  }

  static async countPending(): Promise<number> {
    const [row] = await db
      .select({ value: count() })
      .from(meetingShareRequests)
      .where(eq(meetingShareRequests.status, "pending"));
    return row?.value ?? 0;
  }

  static async listByMeetingId(meetingId: string): Promise<MeetingShareRequestRecord[]> {
    return db
      .select()
      .from(meetingShareRequests)
      .where(eq(meetingShareRequests.meetingId, meetingId))
      .orderBy(desc(meetingShareRequests.createdAt));
  }

  /** Terminal transition (approved/rejected/cancelled) — stamps the resolver + resolved-* fields. */
  static async resolve(id: string, input: ResolveShareRequestInput): Promise<void> {
    const when = input.resolvedAt ?? new Date();
    await db
      .update(meetingShareRequests)
      .set({
        status: input.status,
        resolvedBy: input.resolvedBy ?? null,
        resolvedAt: when,
        resolvedGrantId: input.resolvedGrantId ?? null,
        resolvedShareId: input.resolvedShareId ?? null,
        updatedAt: when,
      })
      .where(eq(meetingShareRequests.id, id));
  }

  /** Author-initiated cancel — same terminal shape as `resolve`, no resolvedBy (self-service, not an admin decision). */
  static async cancel(id: string, when: Date = new Date()): Promise<void> {
    await db
      .update(meetingShareRequests)
      .set({
        status: "cancelled",
        resolvedAt: when,
        updatedAt: when,
      })
      .where(eq(meetingShareRequests.id, id));
  }

  static async deleteById(id: string): Promise<void> {
    await db.delete(meetingShareRequests).where(eq(meetingShareRequests.id, id));
  }

  /** Removes every terminal-state (non-pending) request for a meeting; a pending row is never deletable via this path. */
  static async deleteResolvedByMeetingId(meetingId: string): Promise<number> {
    const deleted = await db
      .delete(meetingShareRequests)
      .where(and(eq(meetingShareRequests.meetingId, meetingId), ne(meetingShareRequests.status, "pending")))
      .returning({ id: meetingShareRequests.id });

    return deleted.length;
  }
}
