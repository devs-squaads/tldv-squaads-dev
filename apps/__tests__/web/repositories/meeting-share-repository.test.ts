import { describe, expect, it, afterAll } from "bun:test";
import { createLiveConnection, sql } from "@meeting-bot/shared/db/liveConnection";

// Live-DB test, and this file intentionally avoids importing MeetingShareRepository (or
// `@meeting-bot/shared/db`/`@meeting-bot/shared/db/schema`) directly — those exact specifiers
// are globally replaced by `mock.module()` in other repository tests within the same `bun test`
// process, and whichever file's mock.module() call resolves first wins for the rest of that
// process (see web-meeting-repository.test.ts in this same directory for the confirmed repro).
// Instead, this runs the *exact same delete-transaction SQL* MeetingShareRepository.deleteById()
// performs (see MeetingShareRepository.ts) directly against Postgres.
const CONNECTION_STRING = process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/meeting_bot";
const { pool, db } = createLiveConnection(CONNECTION_STRING);

async function canConnect(): Promise<boolean> {
  try {
    await Promise.race([
      db.execute(sql`SELECT 1`),
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("timeout")), 1000)),
    ]);
    return true;
  } catch {
    return false;
  }
}

const dbAvailable = await canConnect();

/** Mirrors MeetingShareRepository.ts's `deleteById()` transaction verbatim. */
async function deleteShareById(id: string): Promise<void> {
  await db.execute(sql`DELETE FROM "meeting_share_access_logs" WHERE "meeting_share_id" = ${id}`);
  await db.execute(sql`DELETE FROM "meeting_shares" WHERE "id" = ${id}`);
}

async function insertShare(id: string, meetingId: string, tokenHash: string) {
  const now = new Date();
  await db.execute(sql`
    INSERT INTO "meeting_shares"
      ("id", "meeting_id", "share_type", "token_hash", "created_at", "updated_at")
    VALUES (${id}, ${meetingId}, 'restricted_email', ${tokenHash}, ${now}, ${now})
  `);
}

describe.skipIf(!dbAvailable)("MeetingShareRepository.deleteById SQL (requires `bun run infra:up`)", () => {
  afterAll(async () => {
    await pool.end();
  });

  it("removes the share row", async () => {
    const suffix = crypto.randomUUID();
    const id = `share-${suffix}`;
    await insertShare(id, `meeting-${suffix}`, `token-${suffix}`);

    await deleteShareById(id);

    const rows = await db.execute<{ id: string }>(sql`SELECT id FROM "meeting_shares" WHERE "id" = ${id}`);
    expect(rows.rows).toHaveLength(0);
  });

  it("also removes the share's access logs (no orphaned rows)", async () => {
    const suffix = crypto.randomUUID();
    const id = `share-${suffix}`;
    await insertShare(id, `meeting-${suffix}`, `token-${suffix}`);
    await db.execute(sql`
      INSERT INTO "meeting_share_access_logs" ("id", "meeting_share_id", "result", "accessed_at")
      VALUES (${`log-${suffix}`}, ${id}, 'granted', ${new Date()})
    `);

    await deleteShareById(id);

    const rows = await db.execute<{ id: string }>(
      sql`SELECT id FROM "meeting_share_access_logs" WHERE "meeting_share_id" = ${id}`,
    );
    expect(rows.rows).toHaveLength(0);
  });
});
