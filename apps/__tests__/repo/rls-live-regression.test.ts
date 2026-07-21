import { describe, expect, it, afterAll } from "bun:test";
import { createLiveConnection, sql } from "@meeting-bot/shared/db/liveConnection";

// Live-DB regression: RLS is server behavior, mocking Drizzle can't prove it.
// Auto-skips when no Postgres is reachable so `bun test` still passes without `infra:up`.
//
// This test intentionally avoids `@meeting-bot/shared/db` and
// `@meeting-bot/shared/db/schema` (and bare `"drizzle-orm"`) — those exact
// specifiers are globally replaced by `mock.module()` in repository tests
// within the same `bun test` process (see apps/__tests__/helpers/dbSchemaMock.ts).
// Using them here for real would either get silently mocked itself, or — if
// this file loads first — permanently poison those specifiers for every
// mocked repository test that runs afterwards.
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

async function expectRlsEnabled(table: string): Promise<void> {
  const result = await db.execute<{ relrowsecurity: boolean }>(
    sql`SELECT relrowsecurity FROM pg_class WHERE relname = ${table}`,
  );
  expect(result.rows[0]?.relrowsecurity).toBe(true);
}

describe.skipIf(!dbAvailable)("RLS live regression (requires `bun run infra:up`)", () => {
  afterAll(async () => {
    await pool.end();
  });

  it("users: RLS enabled, Drizzle still reads/writes", async () => {
    await expectRlsEnabled("users");

    const id = crypto.randomUUID();
    await db.execute(
      sql`INSERT INTO "users" ("id", "email", "created_at", "updated_at") VALUES (${id}, ${`${id}@rls-regression.test`}, now(), now())`,
    );
    const found = await db.execute(sql`SELECT id FROM "users" WHERE id = ${id}`);
    expect(found.rows).toHaveLength(1);
    await db.execute(sql`DELETE FROM "users" WHERE id = ${id}`);
  });

  it("authorized_accounts: RLS enabled, Drizzle still reads/writes", async () => {
    await expectRlsEnabled("authorized_accounts");

    const id = crypto.randomUUID();
    await db.execute(
      sql`INSERT INTO "authorized_accounts" ("id", "email", "created_at", "updated_at") VALUES (${id}, ${`${id}@rls-regression.test`}, now(), now())`,
    );
    const found = await db.execute(sql`SELECT id FROM "authorized_accounts" WHERE id = ${id}`);
    expect(found.rows).toHaveLength(1);
    await db.execute(sql`DELETE FROM "authorized_accounts" WHERE id = ${id}`);
  });

  it("meetings: RLS enabled, Drizzle still reads/writes", async () => {
    await expectRlsEnabled("meetings");

    // meetings.owner_id is NOT NULL (009 Phase 1) — needs a real users row.
    const ownerId = crypto.randomUUID();
    await db.execute(
      sql`INSERT INTO "users" ("id", "email", "created_at", "updated_at") VALUES (${ownerId}, ${`${ownerId}@rls-regression.test`}, now(), now())`,
    );

    const id = crypto.randomUUID();
    await db.execute(
      sql`INSERT INTO "meetings" ("id", "url", "owner_id", "created_at", "updated_at") VALUES (${id}, ${"https://meet.google.com/rls-regression"}, ${ownerId}, now(), now())`,
    );
    const found = await db.execute(sql`SELECT id FROM "meetings" WHERE id = ${id}`);
    expect(found.rows).toHaveLength(1);
    await db.execute(sql`DELETE FROM "meetings" WHERE id = ${id}`);
    await db.execute(sql`DELETE FROM "users" WHERE id = ${ownerId}`);
  });

  it("settings: RLS enabled, Drizzle still reads/writes", async () => {
    await expectRlsEnabled("settings");

    const key = `rls-regression-${crypto.randomUUID()}`;
    await db.execute(sql`INSERT INTO "settings" ("key", "value") VALUES (${key}, ${"rls-regression"})`);
    const found = await db.execute(sql`SELECT key FROM "settings" WHERE key = ${key}`);
    expect(found.rows).toHaveLength(1);
    await db.execute(sql`DELETE FROM "settings" WHERE key = ${key}`);
  });

  it("meeting_shares: RLS enabled, Drizzle still reads/writes", async () => {
    await expectRlsEnabled("meeting_shares");

    const id = crypto.randomUUID();
    const meetingId = crypto.randomUUID();
    const tokenHash = crypto.randomUUID();
    // share_type enum dropped "public" (009 Phase 1) — only "restricted_email" remains.
    await db.execute(
      sql`INSERT INTO "meeting_shares" ("id", "meeting_id", "share_type", "token_hash", "created_at", "updated_at") VALUES (${id}, ${meetingId}, ${"restricted_email"}, ${tokenHash}, now(), now())`,
    );
    const found = await db.execute(sql`SELECT id FROM "meeting_shares" WHERE id = ${id}`);
    expect(found.rows).toHaveLength(1);
    await db.execute(sql`DELETE FROM "meeting_shares" WHERE id = ${id}`);
  });

  it("meeting_share_access_logs: RLS enabled, Drizzle still reads/writes", async () => {
    await expectRlsEnabled("meeting_share_access_logs");

    const id = crypto.randomUUID();
    const meetingShareId = crypto.randomUUID();
    await db.execute(
      sql`INSERT INTO "meeting_share_access_logs" ("id", "meeting_share_id", "result", "accessed_at") VALUES (${id}, ${meetingShareId}, ${"granted"}, now())`,
    );
    const found = await db.execute(sql`SELECT id FROM "meeting_share_access_logs" WHERE id = ${id}`);
    expect(found.rows).toHaveLength(1);
    await db.execute(sql`DELETE FROM "meeting_share_access_logs" WHERE id = ${id}`);
  });

  it("chat_messages: RLS enabled, Drizzle still reads/writes", async () => {
    await expectRlsEnabled("chat_messages");

    const id = crypto.randomUUID();
    const userId = crypto.randomUUID();
    await db.execute(
      sql`INSERT INTO "chat_messages" ("id", "user_id", "role", "content", "created_at") VALUES (${id}, ${userId}, ${"user"}, ${"rls-regression"}, now())`,
    );
    const found = await db.execute(sql`SELECT id FROM "chat_messages" WHERE id = ${id}`);
    expect(found.rows).toHaveLength(1);
    await db.execute(sql`DELETE FROM "chat_messages" WHERE id = ${id}`);
  });
});
