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

  /**
   * Terminal transition (approved/rejected/cancelled) — atomic race arbiter: guarded on
   * `status = 'pending'` so only the first of two concurrent callers wins the write. Returns the
   * updated row, or `null` when another call already resolved it first (caller must treat that as
   * "not pending" and stop before any downstream side effect).
   */
  static async resolve(id: string, input: ResolveShareRequestInput): Promise<MeetingShareRequestRecord | null> {
    const when = input.resolvedAt ?? new Date();
    const [row] = await db
      .update(meetingShareRequests)
      .set({
        status: input.status,
        resolvedBy: input.resolvedBy ?? null,
        resolvedAt: when,
        resolvedGrantId: input.resolvedGrantId ?? null,
        resolvedShareId: input.resolvedShareId ?? null,
        updatedAt: when,
      })
      .where(and(eq(meetingShareRequests.id, id), eq(meetingShareRequests.status, "pending")))
      .returning();
    return row ?? null;
  }

  /** Author-initiated cancel — same atomic gate as `resolve`, no resolvedBy (self-service, not an admin decision). */
  static async cancel(id: string, when: Date = new Date()): Promise<MeetingShareRequestRecord | null> {
    const [row] = await db
      .update(meetingShareRequests)
      .set({
        status: "cancelled",
        resolvedAt: when,
        updatedAt: when,
      })
      .where(and(eq(meetingShareRequests.id, id), eq(meetingShareRequests.status, "pending")))
      .returning();
    return row ?? null;
  }

  /**
   * Non-racy follow-up write — stamps the downstream grant/share id onto an already-resolved row.
   * Only called after `resolve()` has atomically flipped status away from "pending", so only the
   * single winning caller ever reaches this; no status guard needed.
   */
  static async attachResolutionRef(
    id: string,
    ref: { resolvedGrantId?: string | null; resolvedShareId?: string | null }
  ): Promise<void> {
    await db
      .update(meetingShareRequests)
      .set({
        resolvedGrantId: ref.resolvedGrantId ?? null,
        resolvedShareId: ref.resolvedShareId ?? null,
        updatedAt: new Date(),
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
