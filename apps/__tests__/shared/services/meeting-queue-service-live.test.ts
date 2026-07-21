import { describe, expect, it, afterAll } from "bun:test";
import { createLiveConnection, sql } from "@meeting-bot/shared/db/liveConnection";

// Live-DB only, kept in its own file (NOT merged into meeting-queue-service.test.ts): that file's
// mocked describe blocks call `mock.module()` on `@meeting-bot/shared/repositories/MeetingRepository`,
// which is the exact specifier `queueMeetingRun` depends on. Even a real (unmocked) import of
// `queueMeetingRun` taken before any mock.module() call still ends up resolving `MeetingRepository`
// through Bun's shared, process-wide module registry once ANY test in the same file mocks that
// specifier — `mock.restore()` does not undo this for already-loaded consumers. This exercises the
// real (source_provider, source_event_id) unique-index race, which a mocked module cannot simulate.
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

const { queueMeetingRun } = await import("../../../../packages/shared/src/services/meetingQueueService");

async function ensureLiveUser(userId: string, email: string) {
  await db.execute(
    sql`INSERT INTO "users" ("id", "email", "created_at", "updated_at") VALUES (${userId}, ${email}, now(), now())
        ON CONFLICT ("id") DO NOTHING`,
  );
}

describe.skipIf(!dbAvailable)("queueMeetingRun — source-event dedup race (requires `bun run infra:up`)", () => {
  const suffix = crypto.randomUUID();
  const ownerId = `owner-${suffix}`;
  const sourceProvider = "google-calendar";

  afterAll(async () => {
    if (dbAvailable) {
      await db.execute(sql`DELETE FROM "meetings" WHERE "owner_id" = ${ownerId}`);
      await db.execute(sql`DELETE FROM "users" WHERE "id" = ${ownerId}`);
    }
    await pool.end();
  });

  it("two concurrent calls for the same event insert exactly one row and the loser returns the winner's { id, ownerId }", async () => {
    await ensureLiveUser(ownerId, `owner-${suffix}@example.com`);
    const sourceEventId = `evt-${suffix}`;
    const params = {
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      botName: "Squaads Bot",
      duration: 60,
      ownerId,
      sourceProvider,
      sourceEventId,
    };

    const [resultA, resultB] = await Promise.all([queueMeetingRun(params), queueMeetingRun(params)]);

    expect(resultA.id).toBe(resultB.id);
    expect(resultA.ownerId).toBe(ownerId);
    expect(resultB.ownerId).toBe(ownerId);

    const rows = await db.execute<{ id: string }>(
      sql`SELECT id FROM "meetings" WHERE "source_provider" = ${sourceProvider} AND "source_event_id" = ${sourceEventId}`,
    );
    expect(rows.rows).toHaveLength(1);
  });

  it("two manually-enqueued meetings with null sourceEventId both persist", async () => {
    await ensureLiveUser(ownerId, `owner-${suffix}@example.com`);

    const resultA = await queueMeetingRun({
      meetingUrl: `https://meet.google.com/manual-a-${suffix}`,
      botName: "Squaads Bot",
      duration: 60,
      ownerId,
    });
    const resultB = await queueMeetingRun({
      meetingUrl: `https://meet.google.com/manual-b-${suffix}`,
      botName: "Squaads Bot",
      duration: 60,
      ownerId,
    });

    expect(resultA.id).not.toBe(resultB.id);
  });

  it("calling again against a pre-existing source-event row returns that row without a second insert", async () => {
    await ensureLiveUser(ownerId, `owner-${suffix}@example.com`);
    const sourceEventId = `evt-repeat-${suffix}`;
    const params = {
      meetingUrl: "https://meet.google.com/repeat-defg-hij",
      botName: "Squaads Bot",
      duration: 60,
      ownerId,
      sourceProvider,
      sourceEventId,
    };

    const first = await queueMeetingRun(params);
    const second = await queueMeetingRun(params);

    expect(second.id).toBe(first.id);

    const rows = await db.execute<{ id: string }>(
      sql`SELECT id FROM "meetings" WHERE "source_provider" = ${sourceProvider} AND "source_event_id" = ${sourceEventId}`,
    );
    expect(rows.rows).toHaveLength(1);
  });
});
