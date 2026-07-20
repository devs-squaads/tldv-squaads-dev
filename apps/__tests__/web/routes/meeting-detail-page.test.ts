/// <reference types="bun" />

import { afterEach, describe, expect, it, mock } from "bun:test";

const moduleMock = mock as typeof mock & {
  module(specifier: string, factory: () => unknown): void;
  restore(): void;
};

afterEach(() => {
  moduleMock.restore();
});

function findElementByType(node: unknown, typeName: string): { props: Record<string, unknown> } | null {
  if (!node || typeof node !== "object") return null;
  const element = node as { type?: unknown; props?: Record<string, unknown> };
  if (typeof element.type === "function" && element.type.name === typeName) {
    return element as { props: Record<string, unknown> };
  }
  const children = element.props?.children;
  const candidates = Array.isArray(children) ? children : [children];
  for (const child of candidates) {
    const found = findElementByType(child, typeName);
    if (found) return found;
  }
  return null;
}

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

  moduleMock.module("@meeting-bot/shared/repositories/MeetingRepository", () => ({
    MeetingRepository: {
      findById: async () => ({ ...meeting }),
    },
  }));

  moduleMock.module("@/services/meetingShareService", () => ({
    MeetingShareService: {
      listSharesByMeetingId: async () => [],
      getTtlOptionsMinutes: () => [60],
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
    importPage: () =>
      import(`../../../web/src/app/(main)/meeting/[id]/page.tsx?test=${Date.now()}`),
  };
}

describe("MeetingPage storage key resolution", () => {
  it("uses the persisted recordingStorageKey when present", async () => {
    const harness = setupHarness({
      recordingStorageKey: "google-meet/daily-standup_2026-01-01_meeting-1.mp4",
    });
    const { default: MeetingPage } = await harness.importPage();

    const element = await MeetingPage({ params: Promise.resolve({ id: "meeting-1" }) });
    const detailsView = findElementByType(element, "MeetingDetailsView");

    expect(harness.signCalls).toEqual(["google-meet/daily-standup_2026-01-01_meeting-1.mp4"]);
    expect((detailsView?.props.initialMeeting as { recordingFilePath: string }).recordingFilePath).toBe(
      "signed:google-meet/daily-standup_2026-01-01_meeting-1.mp4",
    );
  });

  it("falls back to the legacy computed key when recordingStorageKey is null", async () => {
    const harness = setupHarness({ recordingStorageKey: null });
    const { default: MeetingPage } = await harness.importPage();

    await MeetingPage({ params: Promise.resolve({ id: "meeting-1" }) });

    expect(harness.signCalls).toEqual(["google-meet/meeting-1.mp4"]);
  });
});
