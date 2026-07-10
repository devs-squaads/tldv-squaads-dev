import { afterEach, describe, expect, it, mock } from "bun:test";

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

    const queuedRuns: Array<{ botName: string }> = [];

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
          },
        ],
      }),
    }));

    moduleMock.module("@meeting-bot/shared/meetingProvider", () => ({
      isSupportedMeetingUrl: () => true,
      normalizeMeetingUrl: (meetingUrl: string) => meetingUrl,
      getMeetingProviderFromUrl: (meetingUrl: string) => {
        const normalized = meetingUrl.toLowerCase();
        if (normalized.includes("teams.microsoft.com")) return "microsoft-teams";
        if (normalized.includes("zoom.us") || normalized.includes(".zoom.com")) return "zoom";
        if (normalized.includes("meet.google.com")) return "google-meet";
        return "unknown";
      },
    }));

    moduleMock.module("@meeting-bot/shared/repositories/CalendarAccountRepository", () => ({
      CalendarAccountRepository: {
        getCalendarEnabledUsers: async () => [{ id: "user-1" }],
      },
    }));

    moduleMock.module("@meeting-bot/shared/services/meetingQueueService", () => ({
      queueMeetingRun: async (payload: { botName: string }) => {
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
});
