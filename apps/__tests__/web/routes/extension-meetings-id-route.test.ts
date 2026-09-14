/// <reference types="bun" />

import { afterEach, describe, expect, it, mock } from "bun:test";

const moduleMock = mock as typeof mock & {
  module(specifier: string, factory: () => unknown): void;
  restore(): void;
};

afterEach(() => {
  moduleMock.restore();
});

interface HarnessOptions {
  meetingOverrides?: Record<string, unknown>;
  /** userId carried by the extension token. */
  tokenUserId?: string;
  /** What the ownership-scoped lookup returns for that user. */
  scopedMeeting?: Record<string, unknown> | null;
  authorized?: boolean;
}

function setupHarness(options: HarnessOptions = {}) {
  const meeting: Record<string, unknown> = {
    id: "meeting-1",
    url: "https://meet.google.com/abc-defg-hij",
    status: "completed",
    recordingFilePath: "https://bucket.example/existing.mp4",
    recordingStorageKey: null,
    rawTranscription: "Owner [00:03] contenido privado",
    ...options.meetingOverrides,
  };
  const signCalls: string[] = [];
  const scopedLookups: Array<{ userId: string; id: string }> = [];
  const scopedMeeting = options.scopedMeeting === undefined ? meeting : options.scopedMeeting;

  moduleMock.module("@/services/extensionTokens", () => ({
    assertExtensionAccessAuthorized: () =>
      options.authorized === false
        ? { ok: false, response: Response.json({ error: "Unauthorized" }, { status: 401 }) }
        : { ok: true, payload: { userId: options.tokenUserId ?? "user-1", email: "owner@squaads.com" } },
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
    importRoute: () =>
      import(`../../../web/src/app/api/v1/extension/meetings/[id]/route.ts?test=${Date.now()}`),
  };
}

function getExtensionMeeting(id = "meeting-1") {
  return new Request(`http://localhost/api/v1/extension/meetings/${id}`, {
    headers: { Authorization: "Bearer test-token" },
  });
}

describe("GET /api/v1/extension/meetings/:id storage key resolution", () => {
  it("uses the persisted recordingStorageKey when present", async () => {
    const harness = setupHarness({
      meetingOverrides: { recordingStorageKey: "google-meet/daily-standup_2026-01-01_meeting-1.mp4" },
    });
    const { GET } = await harness.importRoute();

    const res = await GET(getExtensionMeeting(), { params: Promise.resolve({ id: "meeting-1" }) });
    const body = await res.json();

    expect(harness.signCalls).toEqual(["google-meet/daily-standup_2026-01-01_meeting-1.mp4"]);
    expect(body.recordingFilePath).toBe("signed:google-meet/daily-standup_2026-01-01_meeting-1.mp4");
  });

  it("falls back to the legacy computed key when recordingStorageKey is null", async () => {
    const harness = setupHarness({ meetingOverrides: { recordingStorageKey: null } });
    const { GET } = await harness.importRoute();

    const res = await GET(getExtensionMeeting(), { params: Promise.resolve({ id: "meeting-1" }) });
    await res.json();

    expect(harness.signCalls).toEqual(["google-meet/meeting-1.mp4"]);
  });
});

describe("GET /api/v1/extension/meetings/:id authorization (spec 015)", () => {
  it("propagates the token rejection", async () => {
    const harness = setupHarness({ authorized: false });
    const { GET } = await harness.importRoute();

    const res = await GET(getExtensionMeeting(), { params: Promise.resolve({ id: "meeting-1" }) });

    expect(res.status).toBe(401);
    expect(harness.scopedLookups).toEqual([]);
  });

  it("scopes the lookup to the token userId", async () => {
    const harness = setupHarness({ tokenUserId: "owner-1" });
    const { GET } = await harness.importRoute();

    await GET(getExtensionMeeting(), { params: Promise.resolve({ id: "meeting-1" }) });

    expect(harness.scopedLookups).toEqual([{ userId: "owner-1", id: "meeting-1" }]);
  });

  it("returns 404 when the token belongs to someone without access", async () => {
    const harness = setupHarness({ tokenUserId: "intruder-9", scopedMeeting: null });
    const { GET } = await harness.importRoute();

    const res = await GET(getExtensionMeeting(), { params: Promise.resolve({ id: "meeting-1" }) });

    expect(res.status).toBe(404);
  });

  it("does not leak the transcript nor sign the recording for a foreign token", async () => {
    const harness = setupHarness({ tokenUserId: "intruder-9", scopedMeeting: null });
    const { GET } = await harness.importRoute();

    const res = await GET(getExtensionMeeting(), { params: Promise.resolve({ id: "meeting-1" }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.rawTranscription).toBeUndefined();
    expect(body.recordingFilePath).toBeUndefined();
    expect(harness.signCalls).toEqual([]);
  });

  it("returns 200 and signs the recording for the owner", async () => {
    const harness = setupHarness({ tokenUserId: "owner-1" });
    const { GET } = await harness.importRoute();

    const res = await GET(getExtensionMeeting(), { params: Promise.resolve({ id: "meeting-1" }) });

    expect(res.status).toBe(200);
    expect(harness.signCalls).toEqual(["google-meet/meeting-1.mp4"]);
  });
});
