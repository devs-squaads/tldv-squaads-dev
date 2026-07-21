import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";

const moduleMock = mock as typeof mock & {
  module(specifier: string, factory: () => unknown): void;
  restore(): void;
};

const ENV_KEYS = [
  "BOT_DEFAULT_NAME",
  "AUTO_JOIN_ORGANIZER_EMAILS",
  "AUTO_JOIN_ENABLED",
  "AUTO_JOIN_REQUIRE_SUPPORTED_LINK",
  "AUTO_JOIN_LEAD_TIME_MINUTES",
  "AUTO_JOIN_LOOKBACK_MINUTES",
  "AUTO_JOIN_LOOKAHEAD_MINUTES",
  "AUTO_JOIN_DEFAULT_DURATION_MINUTES",
] as const;

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

describe("autoJoinPollAndEnqueue", () => {
  it("uses BOT_DEFAULT_NAME for auto-join meetings", async () => {
    process.env.BOT_DEFAULT_NAME = "Legacy Bot";
    process.env.AUTO_JOIN_REQUIRE_SUPPORTED_LINK = "true";

    const queuedRuns: Array<{ botName: string; ownerId?: string; participantEmails?: string[] }> = [];

    moduleMock.module("@/integrations/calendar/CalendarProviderRegistry", () => ({
      getConfiguredCalendarProvider: () => ({
        listMeetingEvents: async () => [
          {
            provider: "google-calendar",
            eventId: "evt-1",
            organizerEmail: "owner@example.com",
            summary: "Calendar Title",
            meetingUrl: "https://meet.google.com/abc-defg-hij",
            startsAt: new Date(Date.now() - 60_000),
            endsAt: new Date(Date.now() + 30 * 60_000),
            ownerUserId: "user-1",
            participantEmails: ["guest@example.com"],
          },
        ],
      }),
    }));

    moduleMock.module("@meeting-bot/shared/repositories/CalendarAccountRepository", () => ({
      CalendarAccountRepository: {
        getCalendarEnabledUsers: async () => [{ id: "user-1" }],
      },
    }));

    moduleMock.module("@meeting-bot/shared/services/meetingQueueService", () => ({
      queueMeetingRun: async (payload: { botName: string; ownerId?: string; participantEmails?: string[] }) => {
        queuedRuns.push(payload);
      },
    }));

    const { autoJoinPollAndEnqueue } = await import(`../../../worker/src/services/autoJoinService.ts?test=${Date.now()}`);

    const result = await autoJoinPollAndEnqueue();

    expect(result.polled).toBe(1);
    expect(result.enqueued).toBe(1);
    expect(queuedRuns.length).toBe(1);
    expect(queuedRuns[0]?.botName).toBe("Legacy Bot");
  });

  it("threads the calendar event's ownerUserId and participantEmails into queueMeetingRun as ownerId (009 Phase 2)", async () => {
    const queuedRuns: Array<{ ownerId?: string; participantEmails?: string[] }> = [];

    moduleMock.module("@/integrations/calendar/CalendarProviderRegistry", () => ({
      getConfiguredCalendarProvider: () => ({
        listMeetingEvents: async () => [
          {
            provider: "google-calendar",
            eventId: "evt-owned",
            organizerEmail: "owner@example.com",
            summary: "Owned Event",
            meetingUrl: "https://meet.google.com/own-defg-hij",
            startsAt: new Date(Date.now() - 60_000),
            endsAt: new Date(Date.now() + 30 * 60_000),
            ownerUserId: "user-42",
            participantEmails: ["guest-a@example.com", "guest-b@example.com"],
          },
        ],
      }),
    }));

    moduleMock.module("@meeting-bot/shared/repositories/CalendarAccountRepository", () => ({
      CalendarAccountRepository: {
        getCalendarEnabledUsers: async () => [{ id: "user-42" }],
      },
    }));

    moduleMock.module("@meeting-bot/shared/services/meetingQueueService", () => ({
      queueMeetingRun: async (payload: { ownerId?: string; participantEmails?: string[] }) => {
        queuedRuns.push(payload);
      },
    }));

    const { autoJoinPollAndEnqueue } = await import(`../../../worker/src/services/autoJoinService.ts?test=${Date.now()}`);

    const result = await autoJoinPollAndEnqueue();

    expect(result.enqueued).toBe(1);
    expect(queuedRuns[0]?.ownerId).toBe("user-42");
    expect(queuedRuns[0]?.participantEmails).toEqual(["guest-a@example.com", "guest-b@example.com"]);
  });

  it("skips enqueueing events with no resolvable owner (service-account fallback) and logs a warning (009 Phase 2)", async () => {
    process.env.AUTO_JOIN_ENABLED = "true";
    process.env.AUTO_JOIN_ORGANIZER_EMAILS = "someone@example.com";

    const queuedRuns: Array<unknown> = [];
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    moduleMock.module("@/integrations/calendar/CalendarProviderRegistry", () => ({
      getConfiguredCalendarProvider: () => ({
        listMeetingEvents: async () => [
          {
            provider: "google-calendar",
            eventId: "evt-ownerless",
            organizerEmail: "someone@example.com",
            summary: "Ownerless Event",
            meetingUrl: "https://meet.google.com/xyz-defg-hij",
            startsAt: new Date(Date.now() - 60_000),
            endsAt: new Date(Date.now() + 30 * 60_000),
          },
        ],
      }),
    }));

    moduleMock.module("@meeting-bot/shared/repositories/CalendarAccountRepository", () => ({
      CalendarAccountRepository: {
        getCalendarEnabledUsers: async () => [],
      },
    }));

    moduleMock.module("@meeting-bot/shared/services/meetingQueueService", () => ({
      queueMeetingRun: async (payload: unknown) => {
        queuedRuns.push(payload);
      },
    }));

    try {
      const { autoJoinPollAndEnqueue } = await import(`../../../worker/src/services/autoJoinService.ts?test=${Date.now()}`);

      const result = await autoJoinPollAndEnqueue();

      expect(result.polled).toBe(1);
      expect(result.enqueued).toBe(0);
      expect(queuedRuns).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
