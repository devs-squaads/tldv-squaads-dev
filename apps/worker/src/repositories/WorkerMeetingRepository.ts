import { db } from "@meeting-bot/shared/db";
import { meetings } from "@meeting-bot/shared/db/schema";
import { and, eq, sql } from "drizzle-orm";
import type { MeetingRecord } from "@meeting-bot/shared/repositories/MeetingRepository";

export class WorkerMeetingRepository {
  static async claimNextPending(): Promise<MeetingRecord | null> {
    return db.transaction(async (tx) => {
      const result = await tx.execute<{ id: string }>(sql`
        select id
        from meetings
        where status = 'pending'
        order by created_at asc
        limit 1
        for update skip locked
      `);

      const candidateId = result.rows[0]?.id;
      if (!candidateId) {
        return null;
      }

      await tx
        .update(meetings)
        .set({
          status: "joining",
          updatedAt: new Date(),
          errorMessage: null,
        })
        .where(and(eq(meetings.id, candidateId), eq(meetings.status, "pending")));

      const [claimed] = await tx.select().from(meetings).where(eq(meetings.id, candidateId)).limit(1);
      return claimed ?? null;
    });
  }
}
