import { afterEach, describe, expect, it, mock } from "bun:test";

const moduleMock = mock as typeof mock & {
  module(specifier: string, factory: () => unknown): void;
  restore(): void;
};

const ENV_KEYS = ["WORKER_MAX_ATTEMPTS", "WORKER_RETRY_BASE_MS", "BOT_DEFAULT_NAME"] as const;

const originalEnv = new Map<string, string | undefined>(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  moduleMock.restore();
});

const UPLOADED_RECORDING_URL = "https://bucket.example/google-meet/meeting-1.mp4";

interface HarnessOptions {
  startBot: () => Promise<{ success: boolean; provider?: string; error?: string }>;
  transcribeRecording: () => Promise<{ text: string; segments: unknown[] }>;
  serializeTranscript?: (segments: unknown, text: unknown) => string;
  refineTranscriptionResult?: (raw: unknown) => unknown;
}

function setupHarness(options: HarnessOptions) {
  const meeting: Record<string, unknown> = {
    id: "meeting-1",
    name: null,
    status: "pending",
    recordingFilePath: null,
  };
  const updates: Array<Record<string, unknown>> = [];
  const uploadFileCalls: Array<{ path: string; key: string; contentType?: string }> = [];
  const accumulateCalls: Array<{ raw: string; clean: string; pairs: unknown }> = [];
  let accumulateShouldThrow = false;
  let startBotCalls = 0;

  moduleMock.module("@/bot/index", () => ({
    startBot: async () => {
      startBotCalls += 1;
      return options.startBot();
    },
  }));

  moduleMock.module("@meeting-bot/shared/repositories/MeetingRepository", () => ({
    MeetingRepository: {
      findById: async () => ({ ...meeting }),
      updateById: async (_id: string, patch: Record<string, unknown>) => {
        updates.push(patch);
        Object.assign(meeting, patch);
      },
    },
  }));

  moduleMock.module("@meeting-bot/shared/integrations/storage/StorageProviderFactory", () => ({
    StorageProviderFactory: {
      getProvider: () => ({
        uploadFile: async (path: string, key: string, contentType?: string) => {
          uploadFileCalls.push({ path, key, contentType });
          return { url: UPLOADED_RECORDING_URL };
        },
      }),
    },
  }));

  moduleMock.module("@/services/meetingAiProcessingService", () => ({
    hasTranscriptionProvider: () => true,
    hasSummaryProvider: () => false,
    loadGlobalTranscriptionSettings: async () => ({ context: "" }),
    resolveTranscriptionOptions: async () => ({}),
    transcribeRecording: options.transcribeRecording,
    refineTranscriptionResult: options.refineTranscriptionResult ?? (async (raw: unknown) => raw),
    serializeTranscript: options.serializeTranscript ?? (() => "transcript"),
    withSummaryDuration: (summary: unknown) => summary,
  }));

  moduleMock.module("@/services/dictionaryCandidateCollection", () => ({
    accumulateDictionaryCandidates: async (
      raw: string,
      clean: string,
      pairs: unknown,
    ) => {
      accumulateCalls.push({ raw, clean, pairs });
      if (accumulateShouldThrow) {
        throw new Error("candidate collection boom");
      }
      return [];
    },
  }));

  moduleMock.module("@/integrations/ai/summary/SummaryProviderFactory", () => ({
    SummaryProviderFactory: {
      getProvider: () => ({ summarize: async () => ({}) }),
    },
  }));

  moduleMock.module("@/repositories/WorkerMeetingRepository", () => ({
    WorkerMeetingRepository: { claimNextPending: async () => null },
  }));

  return {
    meeting,
    updates,
    uploadFileCalls,
    getStartBotCalls: () => startBotCalls,
    getAccumulateCalls: () => [...accumulateCalls],
    setAccumulateThrows: (value: boolean) => {
      accumulateShouldThrow = value;
    },
    importService: () =>
      import(`../../../worker/src/services/meetingWorkerService.ts?test=${Date.now()}`),
  };
}

describe("processClaimedMeeting", () => {
  it("keeps the uploaded recording and does not rejoin when transcription fails after upload", async () => {
    process.env.WORKER_MAX_ATTEMPTS = "3";
    process.env.WORKER_RETRY_BASE_MS = "1";

    const harness = setupHarness({
      startBot: async () => ({ success: true, provider: "google-meet" }),
      transcribeRecording: async () => {
        throw new Error("401 Invalid API Key");
      },
    });

    const { processClaimedMeeting } = await harness.importService();

    const result = await processClaimedMeeting({
      id: "meeting-1",
      url: "https://meet.google.com/abc-defg-hij",
      botName: "Squaads Assistant",
      durationMinutes: 30,
    });

    expect(result.processed).toBe(true);
    expect(harness.getStartBotCalls()).toBe(1);
    expect(harness.meeting.recordingFilePath).toBe(UPLOADED_RECORDING_URL);
    expect(harness.meeting.status).toBe("transcription_error");

    const statuses = harness.updates.map((update) => update.status).filter(Boolean);
    expect(statuses).not.toContain("pending");
  });

  it("still retries when the bot fails before any recording exists", async () => {
    process.env.WORKER_MAX_ATTEMPTS = "2";
    process.env.WORKER_RETRY_BASE_MS = "1";

    const harness = setupHarness({
      startBot: async () => ({ success: false, error: "Bot failed to join" }),
      transcribeRecording: async () => ({ text: "", segments: [] }),
    });

    const { processClaimedMeeting } = await harness.importService();

    const result = await processClaimedMeeting({
      id: "meeting-1",
      url: "https://meet.google.com/abc-defg-hij",
      botName: null,
      durationMinutes: null,
    });

    expect(result.processed).toBe(true);
    expect(harness.getStartBotCalls()).toBe(2);
    expect(harness.meeting.status).toBe("error");
  });

  it("persists a named recordingStorageKey using the meeting name and upload date", async () => {
    process.env.WORKER_MAX_ATTEMPTS = "1";
    process.env.WORKER_RETRY_BASE_MS = "1";

    const harness = setupHarness({
      startBot: async () => ({ success: true, provider: "google-meet" }),
      transcribeRecording: async () => ({ text: "hello", segments: [] }),
    });
    harness.meeting.name = "Daily Standup";

    const { processClaimedMeeting } = await harness.importService();

    await processClaimedMeeting({
      id: "meeting-1",
      url: "https://meet.google.com/abc-defg-hij",
      botName: "Squaads Assistant",
      durationMinutes: 30,
    });

    const namedKeyPattern = /^google-meet\/daily-standup_\d{4}-\d{2}-\d{2}_meeting-1\.mp4$/;
    expect(harness.uploadFileCalls).toHaveLength(1);
    expect(harness.uploadFileCalls[0]?.key).toMatch(namedKeyPattern);
    expect(harness.meeting.recordingStorageKey).toBe(harness.uploadFileCalls[0]?.key);
  });

  it("collects dictionary candidates with raw and refined transcripts after refinement", async () => {
    process.env.WORKER_MAX_ATTEMPTS = "1";
    process.env.WORKER_RETRY_BASE_MS = "1";

    const harness = setupHarness({
      startBot: async () => ({ success: true, provider: "google-meet" }),
      transcribeRecording: async () => ({ text: "RAW TRANSCRIPT", segments: [] }),
      refineTranscriptionResult: async (raw: unknown) => ({ ...(raw as object), text: "CLEAN TRANSCRIPT" }),
      serializeTranscript: (_segments: unknown, text: unknown) => String(text),
    });

    const { processClaimedMeeting } = await harness.importService();

    await processClaimedMeeting({
      id: "meeting-1",
      url: "https://meet.google.com/abc-defg-hij",
      botName: "Squaads Assistant",
      durationMinutes: 30,
    });

    const calls = harness.getAccumulateCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.raw).toBe("RAW TRANSCRIPT");
    expect(calls[0]?.clean).toBe("CLEAN TRANSCRIPT");
    expect(harness.meeting.status).toBe("completed");
  });

  it("does not fail the meeting when dictionary candidate collection throws", async () => {
    process.env.WORKER_MAX_ATTEMPTS = "1";
    process.env.WORKER_RETRY_BASE_MS = "1";

    const harness = setupHarness({
      startBot: async () => ({ success: true, provider: "google-meet" }),
      transcribeRecording: async () => ({ text: "hola", segments: [] }),
    });
    harness.setAccumulateThrows(true);

    const { processClaimedMeeting } = await harness.importService();

    const result = await processClaimedMeeting({
      id: "meeting-1",
      url: "https://meet.google.com/abc-defg-hij",
      botName: "Squaads Assistant",
      durationMinutes: 30,
    });

    expect(result.processed).toBe(true);
    expect(harness.meeting.status).toBe("completed");
  });
});
