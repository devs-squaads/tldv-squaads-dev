/// <reference types="bun" />

import { afterEach, describe, expect, it, mock } from "bun:test";

const moduleMock = mock as typeof mock & {
  module(specifier: string, factory: () => unknown): void;
  restore(): void;
};

afterEach(() => {
  moduleMock.restore();
});

function setupHarness(meetingOverrides: Record<string, unknown>) {
  const meeting: Record<string, unknown> = {
    id: "meeting-1",
    url: "https://meet.google.com/abc-defg-hij",
    status: "completed",
    recordingFilePath: "https://bucket.example/existing.mp4",
    recordingStorageKey: null,
    ...meetingOverrides,
  };
  const signCalls: string[] = [];

  moduleMock.module("next-auth", () => ({
    getServerSession: async () => ({ user: { email: "owner@squaads.com" } }),
  }));

  moduleMock.module("@/auth", () => ({ authOptions: {} }));

  moduleMock.module("@meeting-bot/shared/repositories/MeetingRepository", () => ({
    MeetingRepository: {
      findById: async () => ({ ...meeting }),
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
    importRoute: () => import(`../../../web/src/app/api/meetings/[id]/route.ts?test=${Date.now()}`),
  };
}

describe("GET /api/meetings/:id storage key resolution", () => {
  it("uses the persisted recordingStorageKey when present", async () => {
    const harness = setupHarness({
      recordingStorageKey: "google-meet/daily-standup_2026-01-01_meeting-1.mp4",
    });
    const { GET } = await harness.importRoute();

    const req = new Request("http://localhost/api/meetings/meeting-1");
    const res = await GET(req, { params: Promise.resolve({ id: "meeting-1" }) });
    const body = await res.json();

    expect(harness.signCalls).toEqual(["google-meet/daily-standup_2026-01-01_meeting-1.mp4"]);
    expect(body.recordingFilePath).toBe("signed:google-meet/daily-standup_2026-01-01_meeting-1.mp4");
  });

  it("falls back to the legacy computed key when recordingStorageKey is null", async () => {
    const harness = setupHarness({ recordingStorageKey: null });
    const { GET } = await harness.importRoute();

    const req = new Request("http://localhost/api/meetings/meeting-1");
    const res = await GET(req, { params: Promise.resolve({ id: "meeting-1" }) });
    await res.json();

    expect(harness.signCalls).toEqual(["google-meet/meeting-1.mp4"]);
  });
});
