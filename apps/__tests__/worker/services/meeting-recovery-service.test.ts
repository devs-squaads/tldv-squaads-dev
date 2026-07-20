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
    rawTranscription: null,
    summary: null,
    recordingFilePath: "https://bucket.example/existing.mp4",
    recordingStorageKey: null,
    ...meetingOverrides,
  };
  const downloadCalls: Array<{ key: string; path: string }> = [];

  moduleMock.module("@meeting-bot/shared/repositories/MeetingRepository", () => ({
    MeetingRepository: {
      findById: async () => ({ ...meeting }),
      updateById: async (_id: string, patch: Record<string, unknown>) => {
        Object.assign(meeting, patch);
      },
    },
  }));

  moduleMock.module("@meeting-bot/shared/integrations/storage/StorageProviderFactory", () => ({
    StorageProviderFactory: {
      getProvider: () => ({
        downloadFile: async (key: string, path: string) => {
          downloadCalls.push({ key, path });
          // Stop right after the key resolution is exercised — the rest of
          // the transcription/summary pipeline is out of scope for this test.
          throw new Error("stop-after-download-for-test");
        },
      }),
    },
  }));

  moduleMock.module("@/services/meetingAiProcessingService", () => ({
    hasTranscriptionProvider: () => true,
    hasSummaryProvider: () => true,
    loadGlobalTranscriptionSettings: async () => ({ context: "" }),
    resolveTranscriptionOptions: async () => ({}),
    transcribeRecording: async () => ({ text: "", segments: [] }),
    refineTranscriptionResult: async (raw: unknown) => raw,
    serializeTranscript: () => "",
    withSummaryDuration: (summary: unknown) => summary,
  }));

  return {
    meeting,
    downloadCalls,
    importService: () =>
      import(`../../../worker/src/services/meetingRecoveryService.ts?test=${Date.now()}`),
  };
}

describe("reprocessMeetingTranscription storage key resolution", () => {
  it("uses the persisted recordingStorageKey when present", async () => {
    const harness = setupHarness({
      recordingStorageKey: "google-meet/daily-standup_2026-01-01_meeting-1.mp4",
    });
    const { reprocessMeetingTranscription } = await harness.importService();

    await reprocessMeetingTranscription("meeting-1");

    expect(harness.downloadCalls).toHaveLength(1);
    expect(harness.downloadCalls[0]?.key).toBe("google-meet/daily-standup_2026-01-01_meeting-1.mp4");
  });

  it("falls back to the legacy computed key when recordingStorageKey is null", async () => {
    const harness = setupHarness({ recordingStorageKey: null });
    const { reprocessMeetingTranscription } = await harness.importService();

    await reprocessMeetingTranscription("meeting-1");

    expect(harness.downloadCalls).toHaveLength(1);
    expect(harness.downloadCalls[0]?.key).toBe("google-meet/meeting-1.mp4");
  });
});
