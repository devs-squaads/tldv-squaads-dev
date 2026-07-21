import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { createLiveConnection, sql } from "@meeting-bot/shared/db/liveConnection";

// Live-DB test: the ownership/grant/active-owner visibility rule is a SQL
// predicate (OR + correlated EXISTS + join) — mocking Drizzle can't prove it
// actually filters rows on real Postgres. Auto-skips when no DB is reachable
// so `bun test` still passes without `infra:up` (mirrors
// apps/__tests__/repo/rls-live-regression.test.ts).
//
// This file intentionally avoids `@meeting-bot/shared/db`, `@meeting-bot/shared/db/schema`
// and bare `"drizzle-orm"` (including transitively, by not importing
// `WebMeetingRepository` itself) — those exact specifiers are globally
// replaced by `mock.module()` in other repository tests within the same
// `bun test` process (see apps/__tests__/helpers/dbSchemaMock.ts), and
// whichever file's mock.module() call resolves first wins for the rest of
// that process. Importing WebMeetingRepository here directly was tried and
// confirmed to crash under `bun test apps/__tests__` (full suite) with
// `Export named 'ilike' not found in module 'drizzle-orm'` once another
// repository test's crude mock claims that specifier first. Instead, this
// file runs the *exact same WHERE-clause SQL* WebMeetingRepository.ts builds
// (see `visibleToUser()` there) directly against Postgres, proving the
// predicate itself is correct — regardless of test discovery order.
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

/** Mirrors WebMeetingRepository.ts's `visibleToUser()` WHERE clause verbatim. */
async function visibleMeetingIds(userId: string): Promise<string[]> {
  const result = await db.execute<{ id: string }>(sql`
    SELECT m.id FROM "meetings" m
    WHERE (
      m.owner_id = ${userId}
      OR EXISTS (
        SELECT 1 FROM "meeting_access_grants" g
        WHERE g.meeting_id = m.id
          AND g.grantee_user_id = ${userId}
          AND g.revoked_at IS NULL
          AND (g.expires_at IS NULL OR g.expires_at > now())
      )
    )
    AND EXISTS (
      SELECT 1 FROM "authorized_accounts" a
      INNER JOIN "users" u ON u.email = a.email
      WHERE u.id = m.owner_id AND a.is_active = true
    )
  `);
  return result.rows.map((row) => row.id);
}

describe.skipIf(!dbAvailable)("WebMeetingRepository visibility SQL — ownership-scoped access (requires `bun run infra:up`)", () => {
  const suffix = crypto.randomUUID();
  const userIds = {
    owner: `owner-${suffix}`,
    grantee: `grantee-${suffix}`,
    stranger: `stranger-${suffix}`,
    expiredGrantee: `expired-grantee-${suffix}`,
    revokedGrantee: `revoked-grantee-${suffix}`,
    deactivatedOwner: `deactivated-owner-${suffix}`,
    deactivatedGrantee: `deactivated-grantee-${suffix}`,
  };
  const meetingIds = {
    active: `meeting-active-${suffix}`,
    deactivatedOwner: `meeting-deactivated-owner-${suffix}`,
  };

  async function insertUser(id: string) {
    await db.execute(
      sql`INSERT INTO "users" ("id", "email", "created_at", "updated_at") VALUES (${id}, ${`${id}@web-meeting-repo.test`}, now(), now())`,
    );
  }

  async function insertAuthorizedAccount(email: string, isActive: boolean) {
    await db.execute(
      sql`INSERT INTO "authorized_accounts" ("id", "email", "is_active", "created_at", "updated_at")
          VALUES (${crypto.randomUUID()}, ${email}, ${isActive}, now(), now())`,
    );
  }

  async function insertMeeting(id: string, ownerId: string) {
    await db.execute(
      sql`INSERT INTO "meetings" ("id", "url", "owner_id", "created_at", "updated_at")
          VALUES (${id}, ${"https://meet.google.com/web-meeting-repo-test"}, ${ownerId}, now(), now())`,
    );
  }

  async function insertGrant(
    meetingId: string,
    ownerId: string,
    granteeUserId: string,
    options: { expiresAt?: Date | null; revokedAt?: Date | null } = {},
  ) {
    await db.execute(
      sql`INSERT INTO "meeting_access_grants" ("id", "meeting_id", "owner_id", "grantee_user_id", "expires_at", "revoked_at", "created_at", "updated_at")
          VALUES (${crypto.randomUUID()}, ${meetingId}, ${ownerId}, ${granteeUserId}, ${options.expiresAt ?? null}, ${options.revokedAt ?? null}, now(), now())`,
    );
  }

  beforeAll(async () => {
    if (!dbAvailable) return;

    // Seed once for the whole describe block — this is read-only visibility
    // logic, no test mutates fixture rows, so a shared fixture is safe and
    // avoids re-inserting the same rows before every `it`.
    await insertUser(userIds.owner);
    await insertUser(userIds.grantee);
    await insertUser(userIds.stranger);
    await insertUser(userIds.expiredGrantee);
    await insertUser(userIds.revokedGrantee);
    await insertUser(userIds.deactivatedOwner);
    await insertUser(userIds.deactivatedGrantee);

    await insertAuthorizedAccount(`${userIds.owner}@web-meeting-repo.test`, true);
    await insertAuthorizedAccount(`${userIds.deactivatedOwner}@web-meeting-repo.test`, false);

    await insertMeeting(meetingIds.active, userIds.owner);
    await insertMeeting(meetingIds.deactivatedOwner, userIds.deactivatedOwner);

    await insertGrant(meetingIds.active, userIds.owner, userIds.grantee);
    await insertGrant(meetingIds.active, userIds.owner, userIds.expiredGrantee, {
      expiresAt: new Date(Date.now() - 60_000),
    });
    await insertGrant(meetingIds.active, userIds.owner, userIds.revokedGrantee, {
      revokedAt: new Date(),
    });
    await insertGrant(meetingIds.deactivatedOwner, userIds.deactivatedOwner, userIds.deactivatedGrantee);
  });

  afterAll(async () => {
    if (dbAvailable) {
      await db.execute(sql`DELETE FROM "meeting_access_grants" WHERE "meeting_id" IN (${meetingIds.active}, ${meetingIds.deactivatedOwner})`);
      await db.execute(sql`DELETE FROM "meetings" WHERE "id" IN (${meetingIds.active}, ${meetingIds.deactivatedOwner})`);
      await db.execute(sql`DELETE FROM "authorized_accounts" WHERE "email" LIKE ${"%@web-meeting-repo.test"}`);
      await db.execute(sql`DELETE FROM "users" WHERE "email" LIKE ${"%@web-meeting-repo.test"}`);
    }
    await pool.end();
  });

  it("owner sees their own meeting", async () => {
    expect(await visibleMeetingIds(userIds.owner)).toContain(meetingIds.active);
  });

  it("non-owner without a grant does not see the meeting", async () => {
    expect(await visibleMeetingIds(userIds.stranger)).not.toContain(meetingIds.active);
  });

  it("grantee with a live (non-expired, non-revoked) grant sees the meeting", async () => {
    expect(await visibleMeetingIds(userIds.grantee)).toContain(meetingIds.active);
  });

  it("grantee with an expired grant does not see the meeting", async () => {
    expect(await visibleMeetingIds(userIds.expiredGrantee)).not.toContain(meetingIds.active);
  });

  it("grantee with a revoked grant does not see the meeting", async () => {
    expect(await visibleMeetingIds(userIds.revokedGrantee)).not.toContain(meetingIds.active);
  });

  it("deactivated owner's meetings are invisible even to a valid grantee (no carve-out)", async () => {
    expect(await visibleMeetingIds(userIds.deactivatedGrantee)).not.toContain(meetingIds.deactivatedOwner);
    expect(await visibleMeetingIds(userIds.deactivatedOwner)).not.toContain(meetingIds.deactivatedOwner);
  });
});
