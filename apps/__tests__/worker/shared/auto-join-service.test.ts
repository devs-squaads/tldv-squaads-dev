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

/** Registers no-op UserRepository/MeetingAccessGrantRepository mocks so tests that don't care
 * about the co-attendee grant loop stay hermetic (no accidental live-DB dependency). */
function mockGrantDependencies(overrides: {
  findByEmail?: (email: string) => Promise<{ id: string } | null>;
  existsForMeetingAndGrantee?: (meetingId: string, granteeUserId: string) => Promise<boolean>;
  createDedupedForMeetingAndGrantee?: (values: Record<string, unknown>) => Promise<unknown>;
} = {}) {
  const createCalls: Array<Record<string, unknown>> = [];

  moduleMock.module("@meeting-bot/shared/repositories/UserRepository", () => ({
    UserRepository: {
      findByEmail: overrides.findByEmail || (async () => null),
      // Stubbed to keep this process-wide mock.module() registration (first-registration-wins)
      // satisfying the real UserRepository interface for any other test file that transitively
      // depends on it.
      findByIds: async () => [],
    },
  }));

  moduleMock.module("@meeting-bot/shared/repositories/MeetingAccessGrantRepository", () => ({
    MeetingAccessGrantRepository: {
      existsForMeetingAndGrantee: overrides.existsForMeetingAndGrantee || (async () => false),
      createDedupedForMeetingAndGrantee:
        overrides.createDedupedForMeetingAndGrantee ||
        (async (values: Record<string, unknown>) => {
          createCalls.push(values);
        }),
    },
  }));

  return { createCalls };
}

describe("autoJoinPollAndEnqueue", () => {
  it("uses BOT_DEFAULT_NAME for auto-join meetings", async () => {
    process.env.BOT_DEFAULT_NAME = "Legacy Bot";
    process.env.AUTO_JOIN_REQUIRE_SUPPORTED_LINK = "true";

    const queuedRuns: Array<{ botName: string; ownerId?: string; participantEmails?: string[] }> = [];
    mockGrantDependencies();

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
        return { id: "meeting-1", ownerId: payload.ownerId };
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
    mockGrantDependencies();

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
        return { id: "meeting-owned", ownerId: payload.ownerId };
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

  describe("co-attendee Access Grant (ADR-0007 exception, spec 010 Problem 2)", () => {
    function mockSingleEventCalendar(participantEmails: string[]) {
      moduleMock.module("@/integrations/calendar/CalendarProviderRegistry", () => ({
        getConfiguredCalendarProvider: () => ({
          listMeetingEvents: async () => [
            {
              provider: "google-calendar",
              eventId: "evt-grant",
              organizerEmail: "owner@example.com",
              summary: "Grant Event",
              meetingUrl: "https://meet.google.com/grant-defg-hij",
              startsAt: new Date(Date.now() - 60_000),
              endsAt: new Date(Date.now() + 30 * 60_000),
              ownerUserId: "user-owner",
              participantEmails,
            },
          ],
        }),
      }));

      moduleMock.module("@meeting-bot/shared/repositories/CalendarAccountRepository", () => ({
        CalendarAccountRepository: {
          getCalendarEnabledUsers: async () => [{ id: "user-owner" }],
        },
      }));

      moduleMock.module("@meeting-bot/shared/services/meetingQueueService", () => ({
        queueMeetingRun: async () => ({ id: "meeting-grant", ownerId: "user-owner" }),
      }));
    }

    it("grants access to a non-owner registered attendee with null expiresAt, and skips the Owner + unregistered attendees", async () => {
      mockSingleEventCalendar(["owner@example.com", "guest@example.com", "unregistered@example.com"]);
      const { createCalls } = mockGrantDependencies({
        findByEmail: async (email) => {
          if (email === "owner@example.com") return { id: "user-owner" };
          if (email === "guest@example.com") return { id: "user-guest" };
          return null;
        },
      });

      const { autoJoinPollAndEnqueue } = await import(`../../../worker/src/services/autoJoinService.ts?test=${Date.now()}`);
      await autoJoinPollAndEnqueue();

      expect(createCalls).toHaveLength(1);
      expect(createCalls[0]?.meetingId).toBe("meeting-grant");
      expect(createCalls[0]?.ownerId).toBe("user-owner");
      expect(createCalls[0]?.granteeUserId).toBe("user-guest");
      expect(createCalls[0]?.expiresAt).toBeNull();
    });

    it("does not re-create a grant when one already exists for the pair (repeated poll idempotency)", async () => {
      mockSingleEventCalendar(["guest@example.com"]);
      const { createCalls } = mockGrantDependencies({
        findByEmail: async () => ({ id: "user-guest" }),
        existsForMeetingAndGrantee: async () => true,
      });

      const { autoJoinPollAndEnqueue } = await import(`../../../worker/src/services/autoJoinService.ts?test=${Date.now()}`);
      await autoJoinPollAndEnqueue();

      expect(createCalls).toHaveLength(0);
    });

    it("does not resurrect a deliberately revoked grant — the service trusts the repository's existence check regardless of revokedAt", async () => {
      mockSingleEventCalendar(["guest@example.com"]);
      // existsForMeetingAndGrantee's real semantics (proven at the repository layer) return true
      // even for a revoked row; the service only needs to trust that boolean, not re-derive it.
      const { createCalls } = mockGrantDependencies({
        findByEmail: async () => ({ id: "user-guest" }),
        existsForMeetingAndGrantee: async () => true,
      });

      const { autoJoinPollAndEnqueue } = await import(`../../../worker/src/services/autoJoinService.ts?test=${Date.now()}`);
      await autoJoinPollAndEnqueue();

      expect(createCalls).toHaveLength(0);
    });

    it("isolates one participant's grant failure — the rest of the batch still processes", async () => {
      mockSingleEventCalendar(["fails@example.com", "guest@example.com"]);
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      const { createCalls } = mockGrantDependencies({
        findByEmail: async (email) => {
          if (email === "fails@example.com") throw new Error("lookup exploded");
          if (email === "guest@example.com") return { id: "user-guest" };
          return null;
        },
      });

      try {
        const { autoJoinPollAndEnqueue } = await import(`../../../worker/src/services/autoJoinService.ts?test=${Date.now()}`);
        const result = await autoJoinPollAndEnqueue();

        expect(result.enqueued).toBe(1);
        expect(createCalls).toHaveLength(1);
        expect(createCalls[0]?.granteeUserId).toBe("user-guest");
        expect(warnSpy).toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });
  });
});
