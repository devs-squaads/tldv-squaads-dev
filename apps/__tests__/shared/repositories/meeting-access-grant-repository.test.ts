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

const { MeetingAccessGrantRepository } = await import(
  "../../../../packages/shared/src/repositories/MeetingAccessGrantRepository"
);

function makeGrant(suffix: string, overrides: Partial<{
  id: string;
  meetingId: string;
  ownerId: string;
  granteeUserId: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
}> = {}) {
  const now = new Date();
  return {
    id: `grant-${suffix}`,
    meetingId: `meeting-${suffix}`,
    ownerId: `owner-${suffix}`,
    granteeUserId: `grantee-${suffix}`,
    expiresAt: null as Date | null,
    revokedAt: null as Date | null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe.skipIf(!dbAvailable)("MeetingAccessGrantRepository CRUD (requires `bun run infra:up`)", () => {
  it("inserts a new grant row and finds it by id", async () => {
    const suffix = crypto.randomUUID();
    const grant = makeGrant(suffix);

    await MeetingAccessGrantRepository.create(grant);
    const found = await MeetingAccessGrantRepository.findById(grant.id);

    expect(found?.id).toBe(grant.id);
    expect(found?.granteeUserId).toBe(grant.granteeUserId);

    await db.execute(sql`DELETE FROM "meeting_access_grants" WHERE "id" = ${grant.id}`);
  });

  it("returns null when no grant matches the id", async () => {
    const result = await MeetingAccessGrantRepository.findById(`nope-${crypto.randomUUID()}`);
    expect(result).toBeNull();
  });

  it("returns every grant for a meeting", async () => {
    const suffix = crypto.randomUUID();
    const meetingId = `meeting-${suffix}`;
    const grantA = makeGrant(suffix, { id: `grant-a-${suffix}`, meetingId });
    const grantB = makeGrant(`${suffix}-b`, { id: `grant-b-${suffix}`, meetingId });

    await MeetingAccessGrantRepository.create(grantA);
    await MeetingAccessGrantRepository.create(grantB);

    const result = await MeetingAccessGrantRepository.listByMeetingId(meetingId);

    expect(result.map((r) => r.id).sort()).toEqual([grantA.id, grantB.id].sort());

    await db.execute(sql`DELETE FROM "meeting_access_grants" WHERE "meeting_id" = ${meetingId}`);
  });

  it("findLiveGrant returns null when no grant row exists", async () => {
    const suffix = crypto.randomUUID();
    const result = await MeetingAccessGrantRepository.findLiveGrant(`meeting-${suffix}`, `grantee-${suffix}`);
    expect(result).toBeNull();
  });

  it("findLiveGrant returns the grant row when one exists", async () => {
    const suffix = crypto.randomUUID();
    const grant = makeGrant(suffix);
    await MeetingAccessGrantRepository.create(grant);

    const result = await MeetingAccessGrantRepository.findLiveGrant(grant.meetingId, grant.granteeUserId);
    expect(result?.granteeUserId).toBe(grant.granteeUserId);

    await db.execute(sql`DELETE FROM "meeting_access_grants" WHERE "id" = ${grant.id}`);
  });

  it("revokeById sets revokedAt", async () => {
    const suffix = crypto.randomUUID();
    const grant = makeGrant(suffix);
    await MeetingAccessGrantRepository.create(grant);
    const when = new Date("2026-01-01T00:00:00Z");

    await MeetingAccessGrantRepository.revokeById(grant.id, when);
    const found = await MeetingAccessGrantRepository.findById(grant.id);

    expect(found?.revokedAt?.toISOString()).toBe(when.toISOString());

    await db.execute(sql`DELETE FROM "meeting_access_grants" WHERE "id" = ${grant.id}`);
  });

  it("existsForMeetingAndGrantee returns false when no row matches the pair", async () => {
    const suffix = crypto.randomUUID();
    const result = await MeetingAccessGrantRepository.existsForMeetingAndGrantee(
      `meeting-${suffix}`,
      `grantee-${suffix}`,
    );
    expect(result).toBe(false);
  });

  it("existsForMeetingAndGrantee returns true for a revoked row (idempotency — never silently re-created)", async () => {
    const suffix = crypto.randomUUID();
    const grant = makeGrant(suffix, { revokedAt: new Date() });
    await MeetingAccessGrantRepository.create(grant);

    const result = await MeetingAccessGrantRepository.existsForMeetingAndGrantee(grant.meetingId, grant.granteeUserId);
    expect(result).toBe(true);

    await db.execute(sql`DELETE FROM "meeting_access_grants" WHERE "id" = ${grant.id}`);
  });

  it("createDedupedForMeetingAndGrantee: two concurrent calls for the same pair insert exactly one row", async () => {
    const suffix = crypto.randomUUID();
    const meetingId = `meeting-${suffix}`;
    const granteeUserId = `grantee-${suffix}`;
    const ownerId = `owner-${suffix}`;

    const makeValues = (id: string) => ({
      id,
      meetingId,
      ownerId,
      granteeUserId,
      expiresAt: null as Date | null,
      revokedAt: null as Date | null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const [resultA, resultB] = await Promise.all([
      MeetingAccessGrantRepository.createDedupedForMeetingAndGrantee(makeValues(`grant-a-${suffix}`)),
      MeetingAccessGrantRepository.createDedupedForMeetingAndGrantee(makeValues(`grant-b-${suffix}`)),
    ]);

    expect(resultA.id).toBe(resultB.id);

    const rows = await db.execute<{ id: string }>(
      sql`SELECT id FROM "meeting_access_grants" WHERE "meeting_id" = ${meetingId} AND "grantee_user_id" = ${granteeUserId}`,
    );
    expect(rows.rows).toHaveLength(1);

    await db.execute(sql`DELETE FROM "meeting_access_grants" WHERE "meeting_id" = ${meetingId}`);
  });

  it("upsertActive inserts a new grant when none exists for the pair", async () => {
    const suffix = crypto.randomUUID();
    const grant = makeGrant(suffix);

    const result = await MeetingAccessGrantRepository.upsertActive(grant);

    expect(result.id).toBe(grant.id);
    expect(result.revokedAt).toBeNull();

    await db.execute(sql`DELETE FROM "meeting_access_grants" WHERE "id" = ${grant.id}`);
  });

  it("upsertActive un-revokes and refreshes an existing revoked grant instead of crashing on the unique pair index", async () => {
    const suffix = crypto.randomUUID();
    const revoked = makeGrant(suffix, { revokedAt: new Date("2026-01-01T00:00:00Z") });
    await MeetingAccessGrantRepository.create(revoked);

    const newExpiry = new Date(Date.now() + 60_000);
    const result = await MeetingAccessGrantRepository.upsertActive({
      ...makeGrant(`${suffix}-again`, { meetingId: revoked.meetingId, granteeUserId: revoked.granteeUserId }),
      expiresAt: newExpiry,
    });

    expect(result.id).toBe(revoked.id); // same row, reactivated — not a second insert
    expect(result.revokedAt).toBeNull();
    expect(result.expiresAt?.toISOString()).toBe(newExpiry.toISOString());

    const rows = await db.execute<{ id: string }>(
      sql`SELECT id FROM "meeting_access_grants" WHERE "meeting_id" = ${revoked.meetingId} AND "grantee_user_id" = ${revoked.granteeUserId}`,
    );
    expect(rows.rows).toHaveLength(1);

    await db.execute(sql`DELETE FROM "meeting_access_grants" WHERE "meeting_id" = ${revoked.meetingId}`);
  });

  it("upsertActive is idempotent for an already-active grant (no duplicate-key crash on repeat clicks)", async () => {
    const suffix = crypto.randomUUID();
    const grant = makeGrant(suffix);
    await MeetingAccessGrantRepository.upsertActive(grant);

    const result = await MeetingAccessGrantRepository.upsertActive(
      makeGrant(`${suffix}-again`, { meetingId: grant.meetingId, granteeUserId: grant.granteeUserId }),
    );

    expect(result.id).toBe(grant.id);
    expect(result.revokedAt).toBeNull();

    const rows = await db.execute<{ id: string }>(
      sql`SELECT id FROM "meeting_access_grants" WHERE "meeting_id" = ${grant.meetingId} AND "grantee_user_id" = ${grant.granteeUserId}`,
    );
    expect(rows.rows).toHaveLength(1);

    await db.execute(sql`DELETE FROM "meeting_access_grants" WHERE "meeting_id" = ${grant.meetingId}`);
  });

  it("deleteById removes the row", async () => {
    const suffix = crypto.randomUUID();
    const grant = makeGrant(suffix);
    await MeetingAccessGrantRepository.create(grant);

    await MeetingAccessGrantRepository.deleteById(grant.id);

    const found = await MeetingAccessGrantRepository.findById(grant.id);
    expect(found).toBeNull();
  });

  it("deleteInactiveByMeetingId removes revoked and expired grants, keeps active ones, and returns the deleted count", async () => {
    const suffix = crypto.randomUUID();
    const meetingId = `meeting-${suffix}`;
    const revoked = makeGrant(suffix, { id: `grant-revoked-${suffix}`, meetingId, revokedAt: new Date() });
    const expired = makeGrant(`${suffix}-expired`, {
      id: `grant-expired-${suffix}`,
      meetingId,
      expiresAt: new Date(Date.now() - 60_000),
    });
    const active = makeGrant(`${suffix}-active`, { id: `grant-active-${suffix}`, meetingId });

    await MeetingAccessGrantRepository.create(revoked);
    await MeetingAccessGrantRepository.create(expired);
    await MeetingAccessGrantRepository.create(active);

    const deletedCount = await MeetingAccessGrantRepository.deleteInactiveByMeetingId(meetingId);

    expect(deletedCount).toBe(2);
    expect(await MeetingAccessGrantRepository.findById(revoked.id)).toBeNull();
    expect(await MeetingAccessGrantRepository.findById(expired.id)).toBeNull();
    expect(await MeetingAccessGrantRepository.findById(active.id)).not.toBeNull();

    await db.execute(sql`DELETE FROM "meeting_access_grants" WHERE "meeting_id" = ${meetingId}`);
  });

  it("deleteInactiveByMeetingId returns 0 when there is nothing inactive to delete", async () => {
    const suffix = crypto.randomUUID();
    const deletedCount = await MeetingAccessGrantRepository.deleteInactiveByMeetingId(`meeting-${suffix}`);
    expect(deletedCount).toBe(0);
  });
});

/** Mirrors MeetingAccessGrantRepository.ts's `findLiveGrant()` WHERE clause verbatim. */
async function hasLiveGrant(meetingId: string, granteeUserId: string): Promise<boolean> {
  const result = await db.execute<{ id: string }>(sql`
    SELECT id FROM "meeting_access_grants"
    WHERE meeting_id = ${meetingId}
      AND grantee_user_id = ${granteeUserId}
      AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > now())
    LIMIT 1
  `);
  return result.rows.length > 0;
}

describe.skipIf(!dbAvailable)("MeetingAccessGrantRepository.findLiveGrant SQL — expiry/revocation semantics (requires `bun run infra:up`)", () => {
  const suffix = crypto.randomUUID();
  const meetingId = `meeting-${suffix}`;
  const ownerId = `owner-${suffix}`;

  async function insertGrant(
    id: string,
    granteeUserId: string,
    options: { expiresAt?: Date | null; revokedAt?: Date | null } = {},
  ) {
    await db.execute(
      sql`INSERT INTO "meeting_access_grants" ("id", "meeting_id", "owner_id", "grantee_user_id", "expires_at", "revoked_at", "created_at", "updated_at")
          VALUES (${id}, ${meetingId}, ${ownerId}, ${granteeUserId}, ${options.expiresAt ?? null}, ${options.revokedAt ?? null}, now(), now())`,
    );
  }

  afterAll(async () => {
    if (dbAvailable) {
      await db.execute(sql`DELETE FROM "meeting_access_grants" WHERE "meeting_id" = ${meetingId}`);
    }
    await pool.end();
  });

  it("no-expiry, non-revoked grant is live", async () => {
    await insertGrant(`grant-no-expiry-${suffix}`, `grantee-no-expiry-${suffix}`);
    expect(await hasLiveGrant(meetingId, `grantee-no-expiry-${suffix}`)).toBe(true);
  });

  it("grant with a future expiresAt is live", async () => {
    await insertGrant(`grant-future-${suffix}`, `grantee-future-${suffix}`, {
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(await hasLiveGrant(meetingId, `grantee-future-${suffix}`)).toBe(true);
  });

  it("grant with a past expiresAt is not live", async () => {
    await insertGrant(`grant-expired-${suffix}`, `grantee-expired-${suffix}`, {
      expiresAt: new Date(Date.now() - 60_000),
    });
    expect(await hasLiveGrant(meetingId, `grantee-expired-${suffix}`)).toBe(false);
  });

  it("revoked grant is not live even without an expiresAt", async () => {
    await insertGrant(`grant-revoked-${suffix}`, `grantee-revoked-${suffix}`, {
      revokedAt: new Date(),
    });
    expect(await hasLiveGrant(meetingId, `grantee-revoked-${suffix}`)).toBe(false);
  });

  it("no grant row at all is not live", async () => {
    expect(await hasLiveGrant(meetingId, `grantee-none-${suffix}`)).toBe(false);
  });
});
