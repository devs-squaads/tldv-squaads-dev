import { describe, expect, it, afterAll } from "bun:test";
import { createLiveConnection, sql } from "@meeting-bot/shared/db/liveConnection";

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

const { MeetingShareRequestRepository } = await import(
  "../../../../packages/shared/src/repositories/MeetingShareRequestRepository"
);

function makeRequest(
  suffix: string,
  overrides: Partial<{
    id: string;
    meetingId: string;
    requesterId: string;
    granteeUserId: string | null;
    recipientEmail: string | null;
    recipientEmailNormalized: string | null;
    accessType: "single_use" | "temporary" | "permanent";
    expiresInDays: number | null;
    status: "pending" | "approved" | "rejected" | "cancelled";
  }> = {},
) {
  const now = new Date();
  return {
    id: `msr-${suffix}`,
    meetingId: `meeting-${suffix}`,
    requesterId: `requester-${suffix}`,
    granteeUserId: `grantee-${suffix}` as string | null,
    recipientEmail: null as string | null,
    recipientEmailNormalized: null as string | null,
    accessType: "permanent" as const,
    expiresInDays: null as number | null,
    status: "pending" as const,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function cleanupMeeting(meetingId: string) {
  await db.execute(sql`DELETE FROM "meeting_share_requests" WHERE "meeting_id" = ${meetingId}`);
}

/**
 * `expect(promise).rejects.toBeDefined()` hangs indefinitely against a real DB rejection under
 * bun:test (repro isolated outside the test runner — the same repository call rejects instantly
 * there). Plain try/catch is the reliable idiom for "this must throw" against a live connection.
 */
async function expectRejects(promise: Promise<unknown>): Promise<void> {
  let threw = false;
  try {
    await promise;
  } catch {
    threw = true;
  }
  expect(threw).toBe(true);
}

describe.skipIf(!dbAvailable)("MeetingShareRequestRepository CRUD (requires `bun run infra:up` + `bun run db:push`)", () => {
  it("inserts a new request row and finds it by id", async () => {
    const suffix = crypto.randomUUID();
    const request = makeRequest(suffix);

    await MeetingShareRequestRepository.create(request);
    const found = await MeetingShareRequestRepository.findById(request.id);

    expect(found?.id).toBe(request.id);
    expect(found?.granteeUserId).toBe(request.granteeUserId);
    expect(found?.status).toBe("pending");

    await cleanupMeeting(request.meetingId);
  });

  it("returns null when no request matches the id", async () => {
    const result = await MeetingShareRequestRepository.findById(`nope-${crypto.randomUUID()}`);
    expect(result).toBeNull();
  });

  it("the CHECK constraint rejects a row with neither granteeUserId nor recipientEmailNormalized", async () => {
    const suffix = crypto.randomUUID();
    const request = makeRequest(suffix, { granteeUserId: null, recipientEmailNormalized: null });

    await expectRejects(MeetingShareRequestRepository.create(request));
  });

  it("the CHECK constraint rejects a row with both granteeUserId and recipientEmailNormalized", async () => {
    const suffix = crypto.randomUUID();
    const request = makeRequest(suffix, { recipientEmailNormalized: `recipient-${suffix}@example.com` });

    await expectRejects(MeetingShareRequestRepository.create(request));
  });

  it("accepts an email-only recipient (unregistered path)", async () => {
    const suffix = crypto.randomUUID();
    const request = makeRequest(suffix, {
      granteeUserId: null,
      recipientEmail: `recipient-${suffix}@example.com`,
      recipientEmailNormalized: `recipient-${suffix}@example.com`,
    });

    await MeetingShareRequestRepository.create(request);
    const found = await MeetingShareRequestRepository.findById(request.id);
    expect(found?.recipientEmailNormalized).toBe(request.recipientEmailNormalized);

    await cleanupMeeting(request.meetingId);
  });

  it("listByMeetingId returns every request for a meeting", async () => {
    const suffix = crypto.randomUUID();
    const meetingId = `meeting-${suffix}`;
    const requestA = makeRequest(suffix, { id: `msr-a-${suffix}`, meetingId, granteeUserId: `grantee-a-${suffix}` });
    const requestB = makeRequest(`${suffix}-b`, { id: `msr-b-${suffix}`, meetingId, granteeUserId: `grantee-b-${suffix}` });

    await MeetingShareRequestRepository.create(requestA);
    await MeetingShareRequestRepository.create(requestB);

    const result = await MeetingShareRequestRepository.listByMeetingId(meetingId);
    expect(result.map((r) => r.id).sort()).toEqual([requestA.id, requestB.id].sort());

    await cleanupMeeting(meetingId);
  });

  it("listPending and countPending only include pending requests", async () => {
    const suffix = crypto.randomUUID();
    const meetingId = `meeting-${suffix}`;
    const pending = makeRequest(suffix, { id: `msr-pending-${suffix}`, meetingId, granteeUserId: `grantee-pending-${suffix}` });
    const cancelled = makeRequest(`${suffix}-c`, {
      id: `msr-cancelled-${suffix}`,
      meetingId,
      granteeUserId: `grantee-cancelled-${suffix}`,
      status: "cancelled",
    });

    await MeetingShareRequestRepository.create(pending);
    await MeetingShareRequestRepository.create(cancelled);

    const pendingList = await MeetingShareRequestRepository.listPending();
    const pendingIds = pendingList.map((r) => r.id);

    expect(pendingIds).toContain(pending.id);
    expect(pendingIds).not.toContain(cancelled.id);

    // countPending() must agree with listPending()'s size (same WHERE clause, COUNT vs SELECT *).
    const count = await MeetingShareRequestRepository.countPending();
    expect(count).toBe(pendingList.length);

    await cleanupMeeting(meetingId);
  });

  it("the pending partial-unique index rejects a second pending request for the same (meetingId, granteeUserId)", async () => {
    const suffix = crypto.randomUUID();
    const meetingId = `meeting-${suffix}`;
    const granteeUserId = `grantee-${suffix}`;
    const first = makeRequest(suffix, { id: `msr-first-${suffix}`, meetingId, granteeUserId });
    const second = makeRequest(`${suffix}-2`, { id: `msr-second-${suffix}`, meetingId, granteeUserId });

    await MeetingShareRequestRepository.create(first);
    await expectRejects(MeetingShareRequestRepository.create(second));

    await cleanupMeeting(meetingId);
  });

  it("the pending partial-unique index rejects a second pending request for the same (meetingId, recipientEmailNormalized)", async () => {
    const suffix = crypto.randomUUID();
    const meetingId = `meeting-${suffix}`;
    const email = `recipient-${suffix}@example.com`;
    const first = makeRequest(suffix, {
      id: `msr-first-${suffix}`,
      meetingId,
      granteeUserId: null,
      recipientEmail: email,
      recipientEmailNormalized: email,
    });
    const second = makeRequest(`${suffix}-2`, {
      id: `msr-second-${suffix}`,
      meetingId,
      granteeUserId: null,
      recipientEmail: email,
      recipientEmailNormalized: email,
    });

    await MeetingShareRequestRepository.create(first);
    await expectRejects(MeetingShareRequestRepository.create(second));

    await cleanupMeeting(meetingId);
  });

  it("a rejected pending request does not block a later pending request for the same recipient", async () => {
    const suffix = crypto.randomUUID();
    const meetingId = `meeting-${suffix}`;
    const granteeUserId = `grantee-${suffix}`;
    const first = makeRequest(suffix, { id: `msr-first-${suffix}`, meetingId, granteeUserId });
    await MeetingShareRequestRepository.create(first);

    await MeetingShareRequestRepository.resolve(first.id, { status: "rejected", resolvedBy: `admin-${suffix}` });

    const second = makeRequest(`${suffix}-2`, { id: `msr-second-${suffix}`, meetingId, granteeUserId });
    await MeetingShareRequestRepository.create(second);

    const found = await MeetingShareRequestRepository.findById(second.id);
    expect(found?.status).toBe("pending");

    await cleanupMeeting(meetingId);
  });

  it("resolve transitions status and stamps resolvedBy/resolvedAt/resolvedGrantId", async () => {
    const suffix = crypto.randomUUID();
    const request = makeRequest(suffix);
    await MeetingShareRequestRepository.create(request);

    const when = new Date("2026-01-01T00:00:00Z");
    await MeetingShareRequestRepository.resolve(request.id, {
      status: "approved",
      resolvedBy: `admin-${suffix}`,
      resolvedGrantId: `grant-${suffix}`,
      resolvedAt: when,
    });

    const found = await MeetingShareRequestRepository.findById(request.id);
    expect(found?.status).toBe("approved");
    expect(found?.resolvedBy).toBe(`admin-${suffix}`);
    expect(found?.resolvedGrantId).toBe(`grant-${suffix}`);
    expect(found?.resolvedAt?.toISOString()).toBe(when.toISOString());

    await cleanupMeeting(request.meetingId);
  });

  it("cancel transitions status to cancelled", async () => {
    const suffix = crypto.randomUUID();
    const request = makeRequest(suffix);
    await MeetingShareRequestRepository.create(request);

    await MeetingShareRequestRepository.cancel(request.id);

    const found = await MeetingShareRequestRepository.findById(request.id);
    expect(found?.status).toBe("cancelled");

    await cleanupMeeting(request.meetingId);
  });
});

describe.skipIf(!dbAvailable)("MeetingShareRequestRepository cleanup", () => {
  afterAll(async () => {
    await pool.end();
  });

  it("no-op guard so the pool always closes even if the suite above is skipped", () => {
    expect(true).toBe(true);
  });
});
