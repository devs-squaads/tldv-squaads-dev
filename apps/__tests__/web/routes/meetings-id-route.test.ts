/// <reference types="bun" />

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

const moduleMock = mock as typeof mock & {
  module(specifier: string, factory: () => unknown): void;
  restore(): void;
};

const ORIGINAL_SECRET = process.env.API_ROUTE_SECRET;

afterEach(() => {
  moduleMock.restore();
  if (ORIGINAL_SECRET === undefined) {
    delete process.env.API_ROUTE_SECRET;
  } else {
    process.env.API_ROUTE_SECRET = ORIGINAL_SECRET;
  }
});

interface HarnessOptions {
  meetingOverrides?: Record<string, unknown>;
  /** null = no session at all. */
  session?: { id?: string; email?: string } | null;
  /** What the ownership-scoped lookup returns for this viewer. */
  scopedMeeting?: Record<string, unknown> | null;
  /** What the unscoped (machine-to-machine) lookup returns. */
  unscopedMeeting?: Record<string, unknown> | null;
}

function setupHarness(options: HarnessOptions = {}) {
  const meeting: Record<string, unknown> = {
    id: "meeting-1",
    url: "https://meet.google.com/abc-defg-hij",
    status: "completed",
    recordingFilePath: "https://bucket.example/existing.mp4",
    recordingStorageKey: null,
    rawTranscription: "Owner [00:03] contenido privado",
    summary: "{\"summary\":\"privado\"}",
    ...options.meetingOverrides,
  };
  const signCalls: string[] = [];
  const scopedLookups: Array<{ userId: string; id: string }> = [];
  const unscopedLookups: string[] = [];

  const session = options.session === undefined ? { id: "owner-1", email: "owner@squaads.com" } : options.session;
  const scopedMeeting = options.scopedMeeting === undefined ? meeting : options.scopedMeeting;
  const unscopedMeeting = options.unscopedMeeting === undefined ? meeting : options.unscopedMeeting;

  moduleMock.module("next-auth", () => ({
    getServerSession: async () => (session ? { user: session } : null),
  }));

  moduleMock.module("@/auth", () => ({ authOptions: {} }));

  moduleMock.module("@meeting-bot/shared/repositories/MeetingRepository", () => ({
    MeetingRepository: {
      findById: async (id: string) => {
        unscopedLookups.push(id);
        return unscopedMeeting ? { ...unscopedMeeting } : null;
      },
    },
  }));

  moduleMock.module("@/repositories/WebMeetingRepository", () => ({
    WebMeetingRepository: {
      findByIdForUser: async (userId: string, id: string) => {
        scopedLookups.push({ userId, id });
        return scopedMeeting ? { ...scopedMeeting } : null;
      },
    },
  }));

  moduleMock.module("@meeting-bot/shared/integrations/storage/StorageProviderFactory", () => ({
    StorageProviderFactory: {
      getProvider: () => ({
        getSignedUrl: async (key: string) => {
          signCalls.push(key);
          return `signed:${key}`;
        },
      }),
    },
  }));

  return {
    meeting,
    signCalls,
    scopedLookups,
    unscopedLookups,
    importRoute: () => import(`../../../web/src/app/api/meetings/[id]/route.ts?test=${Date.now()}`),
  };
}

function getMeeting(id = "meeting-1", headers: Record<string, string> = {}) {
  return new Request(`http://localhost/api/meetings/${id}`, { headers });
}

describe("GET /api/meetings/:id storage key resolution", () => {
  it("uses the persisted recordingStorageKey when present", async () => {
    const harness = setupHarness({
      meetingOverrides: { recordingStorageKey: "google-meet/daily-standup_2026-01-01_meeting-1.mp4" },
    });
    const { GET } = await harness.importRoute();

    const res = await GET(getMeeting(), { params: Promise.resolve({ id: "meeting-1" }) });
    const body = await res.json();

    expect(harness.signCalls).toEqual(["google-meet/daily-standup_2026-01-01_meeting-1.mp4"]);
    expect(body.recordingFilePath).toBe("signed:google-meet/daily-standup_2026-01-01_meeting-1.mp4");
  });

  it("falls back to the legacy computed key when recordingStorageKey is null", async () => {
    const harness = setupHarness({ meetingOverrides: { recordingStorageKey: null } });
    const { GET } = await harness.importRoute();

    const res = await GET(getMeeting(), { params: Promise.resolve({ id: "meeting-1" }) });
    await res.json();

    expect(harness.signCalls).toEqual(["google-meet/meeting-1.mp4"]);
  });

  it("scopes the lookup to the session user instead of reading by id alone", async () => {
    const harness = setupHarness();
    const { GET } = await harness.importRoute();

    await GET(getMeeting(), { params: Promise.resolve({ id: "meeting-1" }) });

    expect(harness.scopedLookups).toEqual([{ userId: "owner-1", id: "meeting-1" }]);
    expect(harness.unscopedLookups).toEqual([]);
  });
});

describe("GET /api/meetings/:id authorization (spec 015)", () => {
  beforeEach(() => {
    delete process.env.API_ROUTE_SECRET;
  });

  it("returns 401 when there is neither a session nor a secret", async () => {
    const harness = setupHarness({ session: null });
    const { GET } = await harness.importRoute();

    const res = await GET(getMeeting(), { params: Promise.resolve({ id: "meeting-1" }) });

    expect(res.status).toBe(401);
    expect(harness.scopedLookups).toEqual([]);
    expect(harness.unscopedLookups).toEqual([]);
  });

  it("returns 404 to an authenticated user with no ownership and no grant", async () => {
    const harness = setupHarness({
      session: { id: "intruder-9", email: "intruder@squaads.com" },
      scopedMeeting: null,
    });
    const { GET } = await harness.importRoute();

    const res = await GET(getMeeting(), { params: Promise.resolve({ id: "meeting-1" }) });

    expect(res.status).toBe(404);
    // El camino sin scoping ni siquiera se consulta: no se filtra la existencia del id.
    expect(harness.unscopedLookups).toEqual([]);
  });

  it("never leaks transcript, summary or a signed URL on the 404 path", async () => {
    const harness = setupHarness({
      session: { id: "intruder-9", email: "intruder@squaads.com" },
      scopedMeeting: null,
    });
    const { GET } = await harness.importRoute();

    const res = await GET(getMeeting(), { params: Promise.resolve({ id: "meeting-1" }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.rawTranscription).toBeUndefined();
    expect(body.summary).toBeUndefined();
    expect(body.recordingFilePath).toBeUndefined();
    expect(harness.signCalls).toEqual([]);
  });

  it("returns 200 to the owner and signs the recording", async () => {
    const harness = setupHarness({ session: { id: "owner-1", email: "owner@squaads.com" } });
    const { GET } = await harness.importRoute();

    const res = await GET(getMeeting(), { params: Promise.resolve({ id: "meeting-1" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe("meeting-1");
    expect(harness.signCalls).toEqual(["google-meet/meeting-1.mp4"]);
  });

  it("returns 200 to a grantee the scoped lookup resolves", async () => {
    const harness = setupHarness({ session: { id: "grantee-2", email: "grantee@squaads.com" } });
    const { GET } = await harness.importRoute();

    const res = await GET(getMeeting(), { params: Promise.resolve({ id: "meeting-1" }) });

    expect(res.status).toBe(200);
    expect(harness.scopedLookups).toEqual([{ userId: "grantee-2", id: "meeting-1" }]);
  });

  it("keeps the machine-to-machine secret path unscoped", async () => {
    process.env.API_ROUTE_SECRET = "s3cret";
    // El lookup con ownership no resolvería nada: el worker no es Owner de la reunión.
    const harness = setupHarness({ session: null, scopedMeeting: null });
    const { GET } = await harness.importRoute();

    const res = await GET(getMeeting("meeting-1", { Authorization: "Bearer s3cret" }), {
      params: Promise.resolve({ id: "meeting-1" }),
    });

    expect(res.status).toBe(200);
    expect(harness.unscopedLookups).toEqual(["meeting-1"]);
    expect(harness.scopedLookups).toEqual([]);
  });

  it("rejects a wrong bearer secret", async () => {
    process.env.API_ROUTE_SECRET = "s3cret";
    const harness = setupHarness({ session: null });
    const { GET } = await harness.importRoute();

    const res = await GET(getMeeting("meeting-1", { Authorization: "Bearer nope" }), {
      params: Promise.resolve({ id: "meeting-1" }),
    });

    expect(res.status).toBe(401);
    expect(harness.unscopedLookups).toEqual([]);
  });
});
