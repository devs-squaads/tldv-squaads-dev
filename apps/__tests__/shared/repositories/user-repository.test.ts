import { describe, expect, it, afterAll } from "bun:test";
import { createLiveConnection, sql } from "@meeting-bot/shared/db/liveConnection";

// Live-DB only: this repository's `db` import is the shared
// `@meeting-bot/shared/db` specifier, which other repository tests mock at
// the module level. Bun's `mock.module()` only honors the first registration
// per specifier per test process (not per file), so a second file mocking
// the same specifier silently loses to whichever file's registration ran
// first — an outcome that varies by test-discovery order between OSes (this
// broke in CI while passing locally). Using a real connection instead of
// racing for the mock avoids the collision entirely.
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

const { UserRepository } = await import("../../../../packages/shared/src/repositories/UserRepository");

describe.skipIf(!dbAvailable)("UserRepository.findByEmail (requires `bun run infra:up`)", () => {
  const suffix = crypto.randomUUID();
  const userId = `user-${suffix}`;
  const email = `owner-${suffix}@squaads.com`;

  afterAll(async () => {
    if (dbAvailable) {
      await db.execute(sql`DELETE FROM "users" WHERE "id" = ${userId}`);
    }
    await pool.end();
  });

  it("returns null when no user matches the email (machine-to-machine ownerEmail resolution miss)", async () => {
    const result = await UserRepository.findByEmail(`nobody-${suffix}@squaads.com`);
    expect(result).toBeNull();
  });

  it("returns the matching user's id and email when one exists", async () => {
    await db.execute(
      sql`INSERT INTO "users" ("id", "email", "created_at", "updated_at")
          VALUES (${userId}, ${email}, now(), now())`,
    );

    const result = await UserRepository.findByEmail(email);
    expect(result?.id).toBe(userId);
    expect(result?.email).toBe(email);
  });
});
