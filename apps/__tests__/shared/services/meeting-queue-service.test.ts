import { afterEach, describe, expect, it, mock } from "bun:test";

const moduleMock = mock as typeof mock & {
  module(specifier: string, factory: () => unknown): void;
  restore(): void;
};

afterEach(() => {
  moduleMock.restore();
});

function setupHarness() {
  const insertCalls: Array<Record<string, unknown>> = [];

  moduleMock.module("@meeting-bot/shared/repositories/MeetingRepository", () => ({
    MeetingRepository: {
      findBySourceEvent: async () => null,
      findActiveByUrlCreatedAfter: async () => null,
      insert: async (values: Record<string, unknown>) => {
        insertCalls.push(values);
      },
    },
  }));

  return { insertCalls };
}

async function importQueueMeetingRun() {
  const mod = await import(`../../../../packages/shared/src/services/meetingQueueService.ts?test=${Date.now()}-${Math.random()}`);
  return mod.queueMeetingRun as (params: Record<string, unknown>) => Promise<{ id: string }>;
}

describe("queueMeetingRun — mandatory ownerId (009 Phase 2)", () => {
  it("persists ownerId on the inserted meeting", async () => {
    const { insertCalls } = setupHarness();
    const queueMeetingRun = await importQueueMeetingRun();

    await queueMeetingRun({
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      botName: "Squaads Bot",
      duration: 60,
      ownerId: "user-1",
    });

    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]?.ownerId).toBe("user-1");
  });

  it("persists participantEmails when provided", async () => {
    const { insertCalls } = setupHarness();
    const queueMeetingRun = await importQueueMeetingRun();

    await queueMeetingRun({
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      botName: "Squaads Bot",
      duration: 60,
      ownerId: "user-1",
      participantEmails: ["guest-a@example.com", "guest-b@example.com"],
    });

    expect(insertCalls[0]?.participantEmails).toEqual(["guest-a@example.com", "guest-b@example.com"]);
  });

  it("defaults participantEmails to null when omitted", async () => {
    const { insertCalls } = setupHarness();
    const queueMeetingRun = await importQueueMeetingRun();

    await queueMeetingRun({
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      botName: "Squaads Bot",
      duration: 60,
      ownerId: "user-1",
    });

    expect(insertCalls[0]?.participantEmails).toBeNull();
  });
});
