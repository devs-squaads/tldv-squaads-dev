/// <reference types="bun" />

import { afterEach, describe, expect, it, mock } from "bun:test";
import { EXTENSION_TRACKABLE_FRESHNESS_MS } from "@meeting-bot/shared/domain/meetingStatus";

const moduleMock = mock as typeof mock & {
  module(specifier: string, factory: () => unknown): void;
  restore(): void;
};

afterEach(() => {
  moduleMock.restore();
});

function setupHarness(meeting: Record<string, unknown> | null) {
  const lookupCalls: Array<{ url: string; ownerId: string; createdAfter: Date }> = [];

  moduleMock.module("@/services/extensionTokens", () => ({
    assertExtensionAccessAuthorized: () => ({
      ok: true,
      payload: { userId: "user-1", email: "owner@squaads.com" },
    }),
  }));

  moduleMock.module("@meeting-bot/shared/repositories/MeetingRepository", () => ({
    MeetingRepository: {
      findTrackableByUrlAndOwner: async (url: string, ownerId: string, createdAfter: Date) => {
        lookupCalls.push({ url, ownerId, createdAfter });
        return meeting;
      },
    },
  }));

  return {
    lookupCalls,
    importRoute: () =>
      import(`../../../web/src/app/api/v1/extension/meetings/status/route.ts?test=${Date.now()}`),
  };
}

describe("GET /api/v1/extension/meetings/status", () => {
  it("finds an owned active meeting older than ten minutes within the freshness window", async () => {
    const lookupStartedAt = Date.now();
    const createdAt = new Date(lookupStartedAt - 2 * 60 * 60 * 1000);
    const updatedAt = new Date(lookupStartedAt - 60 * 60 * 1000);
    const harness = setupHarness({
      id: "meeting-1",
      url: "https://meet.google.com/abc-defg-hij",
      status: "recording",
      botName: "Squaads Assistant",
      errorMessage: null,
      createdAt,
      updatedAt,
    });
    const { GET } = await harness.importRoute();

    const req = {
      nextUrl: new URL(
        "http://localhost/api/v1/extension/meetings/status?url=https%3A%2F%2Fmeet.google.com%2Fabc-defg-hij&provider=google-meet",
      ),
      headers: new Headers({ Authorization: "Bearer test-token" }),
    };
    const res = await GET(req as never);
    const body = await res.json();

    expect(harness.lookupCalls).toHaveLength(1);
    expect(harness.lookupCalls[0]).toMatchObject({
      url: "https://meet.google.com/abc-defg-hij",
      ownerId: "user-1",
    });
    expect(harness.lookupCalls[0]!.createdAfter.getTime()).toBeGreaterThanOrEqual(
      lookupStartedAt - EXTENSION_TRACKABLE_FRESHNESS_MS,
    );
    expect(harness.lookupCalls[0]!.createdAfter.getTime()).toBeLessThanOrEqual(
      Date.now() - EXTENSION_TRACKABLE_FRESHNESS_MS,
    );
    expect(res.status).toBe(200);
    expect(body.active).toBe(true);
    expect(body.meeting.id).toBe("meeting-1");
  });

  it("returns no meeting when rows older than the freshness window have no valid match", async () => {
    const harness = setupHarness(null);
    const { GET } = await harness.importRoute();

    const req = {
      nextUrl: new URL(
        "http://localhost/api/v1/extension/meetings/status?url=https%3A%2F%2Fmeet.google.com%2Fabc-defg-hij",
      ),
      headers: new Headers({ Authorization: "Bearer test-token" }),
    };
    const res = await GET(req as never);
    const body = await res.json();

    expect(body).toEqual({
      active: false,
      meeting: null,
      normalizedUrl: "https://meet.google.com/abc-defg-hij",
    });
  });

  it("returns an owned transcription error meeting as trackable for recovery", async () => {
    const harness = setupHarness({
      id: "meeting-recovering",
      url: "https://meet.google.com/abc-defg-hij",
      status: "transcription_error",
      botName: "Squaads Assistant",
      errorMessage: "Transcription failed",
      createdAt: new Date("2026-07-27T08:00:00.000Z"),
      updatedAt: new Date("2026-07-27T09:00:00.000Z"),
    });
    const { GET } = await harness.importRoute();

    const req = {
      nextUrl: new URL(
        "http://localhost/api/v1/extension/meetings/status?url=https%3A%2F%2Fmeet.google.com%2Fabc-defg-hij",
      ),
      headers: new Headers({ Authorization: "Bearer test-token" }),
    };
    const res = await GET(req as never);
    const body = await res.json();

    expect(harness.lookupCalls).toHaveLength(1);
    expect(harness.lookupCalls[0]).toMatchObject({
      url: "https://meet.google.com/abc-defg-hij",
      ownerId: "user-1",
    });
    expect(body.active).toBe(true);
    expect(body.meeting.status).toBe("transcription_error");
  });
});
