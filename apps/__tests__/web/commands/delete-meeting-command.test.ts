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
    recordingFilePath: "https://bucket.example/existing.mp4",
    recordingStorageKey: null,
    ...meetingOverrides,
  };
  const deleteFileCalls: string[] = [];
  const deletedIds: string[] = [];

  moduleMock.module("@meeting-bot/shared/repositories/MeetingRepository", () => ({
    MeetingRepository: {
      findById: async () => ({ ...meeting }),
    },
  }));

  moduleMock.module("@meeting-bot/shared/integrations/storage/StorageProviderFactory", () => ({
    StorageProviderFactory: {
      getProvider: () => ({
        deleteFile: async (key: string) => {
          deleteFileCalls.push(key);
        },
      }),
    },
  }));

  moduleMock.module("@/repositories/WebMeetingRepository", () => ({
    WebMeetingRepository: {
      deleteById: async (id: string) => {
        deletedIds.push(id);
      },
    },
  }));

  return {
    meeting,
    deleteFileCalls,
    deletedIds,
    importCommand: () =>
      import(`../../../web/src/commands/meeting/DeleteMeetingCommand.ts?test=${Date.now()}`),
  };
}

describe("DeleteMeetingCommand storage key resolution", () => {
  it("uses the persisted recordingStorageKey when present", async () => {
    const harness = setupHarness({
      recordingStorageKey: "google-meet/daily-standup_2026-01-01_meeting-1.mp4",
    });
    const { DeleteMeetingCommand } = await harness.importCommand();

    const result = await new DeleteMeetingCommand("meeting-1").execute();

    expect(result.success).toBe(true);
    expect(harness.deleteFileCalls).toEqual(["google-meet/daily-standup_2026-01-01_meeting-1.mp4"]);
  });

  it("falls back to the legacy computed key when recordingStorageKey is null", async () => {
    const harness = setupHarness({ recordingStorageKey: null });
    const { DeleteMeetingCommand } = await harness.importCommand();

    const result = await new DeleteMeetingCommand("meeting-1").execute();

    expect(result.success).toBe(true);
    expect(harness.deleteFileCalls).toEqual(["google-meet/meeting-1.mp4"]);
  });
});
