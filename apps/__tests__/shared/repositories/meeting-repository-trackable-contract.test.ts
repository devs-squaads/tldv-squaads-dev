import { describe, expect, it, afterAll, afterEach } from "bun:test";
import { createLiveConnection, sql } from "@meeting-bot/shared/db/liveConnection";
import {
  EXTENSION_TRACKABLE_FRESHNESS_MS,
  EXTENSION_TRACKABLE_STATUSES,
  type MeetingStatus,
} from "@meeting-bot/shared/domain/meetingStatus";

// Live-DB only — see MeetingAccessGrantRepository's test file for why (Bun's
// mock.module() only honors the first registration per specifier per process).
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

const { MeetingRepository } = await import("../../../../packages/shared/src/repositories/MeetingRepository");

// Ids inserted by the current test, cleaned up by afterEach so a failing
// assertion can never orphan rows (straight-line DELETEs are skipped on throw).
const insertedUserIds: string[] = [];
const insertedMeetingIds: string[] = [];

async function insertUser(id: string): Promise<void> {
  insertedUserIds.push(id);
  await db.execute(
    sql`INSERT INTO "users" ("id", "email", "created_at", "updated_at")
        VALUES (${id}, ${`${id}@squaads.com`}, now(), now())`,
  );
}

async function insertMeeting(params: {
  id: string;
  ownerId: string;
  url: string;
  status: MeetingStatus;
  createdAt: Date;
}): Promise<void> {
  insertedMeetingIds.push(params.id);
  await db.execute(
    sql`INSERT INTO "meetings" ("id", "url", "owner_id", "status", "created_at", "updated_at")
        VALUES (${params.id}, ${params.url}, ${params.ownerId}, ${params.status}, ${params.createdAt}, ${params.createdAt})`,
  );
}

/** Deletes meetings before users so the owner FK never blocks cleanup. */
async function cleanupInsertedRows(): Promise<void> {
  const meetingIds = insertedMeetingIds.splice(0);
  const userIds = insertedUserIds.splice(0);
  if (meetingIds.length > 0) {
    await db.execute(sql`DELETE FROM "meetings" WHERE "id" IN (${sql.join(meetingIds, sql`, `)})`);
  }
  if (userIds.length > 0) {
    await db.execute(sql`DELETE FROM "users" WHERE "id" IN (${sql.join(userIds, sql`, `)})`);
  }
}

describe.skipIf(!dbAvailable)("MeetingRepository.findTrackableByUrlAndOwner (requires `bun run infra:up`)", () => {
  afterEach(cleanupInsertedRows);

  afterAll(async () => {
    if (dbAvailable) await pool.end();
  });

  it("does not return a meeting with the same URL owned by a different user (cross-tenant leak guard)", async () => {
    const suffix = crypto.randomUUID();
    const ownerId = `owner-${suffix}`;
    const otherOwnerId = `other-owner-${suffix}`;
    const url = `https://meet.example.com/${suffix}`;
    const meetingId = `meeting-${suffix}`;
    const createdAfter = new Date(Date.now() - 60_000);

    await insertUser(ownerId);
    await insertUser(otherOwnerId);
    await insertMeeting({ id: meetingId, ownerId: otherOwnerId, url, status: "recording", createdAt: new Date() });

    const result = await MeetingRepository.findTrackableByUrlAndOwner(url, ownerId, createdAfter);
    expect(result).toBeNull();
  });

  it("excludes a meeting created before createdAfter, includes one created after", async () => {
    const suffix = crypto.randomUUID();
    const ownerId = `owner-${suffix}`;
    const url = `https://meet.example.com/${suffix}`;
    const staleId = `meeting-stale-${suffix}`;
    const freshId = `meeting-fresh-${suffix}`;
    const createdAfter = new Date();

    await insertUser(ownerId);
    await insertMeeting({
      id: staleId,
      ownerId,
      url,
      status: "recording",
      createdAt: new Date(createdAfter.getTime() - 60_000),
    });

    const staleResult = await MeetingRepository.findTrackableByUrlAndOwner(url, ownerId, createdAfter);
    expect(staleResult).toBeNull();

    await insertMeeting({
      id: freshId,
      ownerId,
      url,
      status: "recording",
      createdAt: new Date(createdAfter.getTime() + 60_000),
    });

    const freshResult = await MeetingRepository.findTrackableByUrlAndOwner(url, ownerId, createdAfter);
    expect(freshResult?.id).toBe(freshId);
  });

  it("excludes a non-trackable status (completed) but includes transcription_error", async () => {
    const suffix = crypto.randomUUID();
    const ownerId = `owner-${suffix}`;
    const url = `https://meet.example.com/${suffix}`;
    const completedId = `meeting-completed-${suffix}`;
    const errorId = `meeting-transcription-error-${suffix}`;
    const createdAfter = new Date(Date.now() - 60_000);

    await insertUser(ownerId);
    await insertMeeting({ id: completedId, ownerId, url, status: "completed", createdAt: new Date() });

    const completedResult = await MeetingRepository.findTrackableByUrlAndOwner(url, ownerId, createdAfter);
    expect(completedResult).toBeNull();

    await insertMeeting({ id: errorId, ownerId, url, status: "transcription_error", createdAt: new Date() });

    const errorResult = await MeetingRepository.findTrackableByUrlAndOwner(url, ownerId, createdAfter);
    expect(errorResult?.id).toBe(errorId);
  });

  it("returns the most recent matching row when two valid rows exist (newest-first)", async () => {
    const suffix = crypto.randomUUID();
    const ownerId = `owner-${suffix}`;
    const url = `https://meet.example.com/${suffix}`;
    const olderId = `meeting-older-${suffix}`;
    const newerId = `meeting-newer-${suffix}`;
    const createdAfter = new Date(Date.now() - 60_000);
    const now = new Date();

    await insertUser(ownerId);
    await insertMeeting({ id: olderId, ownerId, url, status: "recording", createdAt: new Date(now.getTime() - 5_000) });
    await insertMeeting({ id: newerId, ownerId, url, status: "transcribing", createdAt: now });

    const result = await MeetingRepository.findTrackableByUrlAndOwner(url, ownerId, createdAfter);
    expect(result?.id).toBe(newerId);
  });
});

describe("MeetingRepository trackable lookup contract — exported values", () => {
  it("uses a rolling 24h freshness window that supports meetings longer than ten minutes", () => {
    expect(EXTENSION_TRACKABLE_FRESHNESS_MS).toBe(24 * 60 * 60 * 1000);
    expect(EXTENSION_TRACKABLE_FRESHNESS_MS).toBeGreaterThan(10 * 60 * 1000);
  });

  it("keeps transcription error recovery inside the trackable status set", () => {
    expect(EXTENSION_TRACKABLE_STATUSES).toContain("transcription_error");
  });
});
