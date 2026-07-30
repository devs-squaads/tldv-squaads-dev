import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";

const moduleMock = mock as typeof mock & {
  module(specifier: string, factory: () => unknown): void;
  restore(): void;
};

afterEach(() => {
  moduleMock.restore();
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
});

const RAW_EVENT = {
  id: "evt-1",
  organizer: { email: "owner@example.com" },
  creator: { email: "owner@example.com" },
  summary: "Weekly Sync",
  hangoutLink: "https://meet.google.com/abc-defg-hij",
  start: { dateTime: "2026-07-20T10:00:00.000Z" },
  end: { dateTime: "2026-07-20T10:30:00.000Z" },
  attendees: [{ email: "Guest-A@example.com" }, { email: "guest-b@example.com" }, { email: "" }],
};

function mockGoogleapis() {
  moduleMock.module("googleapis", () => ({
    google: {
      auth: {
        OAuth2: class {
          setCredentials() {}
        },
        GoogleAuth: class {},
        JWT: class {},
      },
      calendar: () => ({
        events: {
          list: async () => ({ data: { items: [RAW_EVENT] } }),
        },
      }),
    },
  }));
}

async function importProvider() {
  const mod = await import(`../../../worker/src/integrations/calendar/providers/GoogleCalendarProvider.ts?test=${Date.now()}-${Math.random()}`);
  return mod.GoogleCalendarProvider;
}

describe("GoogleCalendarProvider — owner/attendee capture (009 Phase 2)", () => {
  it("stamps ownerUserId per OAuth-connected user and maps event.attendees to participantEmails", async () => {
    mockGoogleapis();
    moduleMock.module("@meeting-bot/shared/repositories/CalendarAccountRepository", () => ({
      CalendarAccountRepository: {
        getCalendarEnabledUsers: async () => [
          {
            id: "user-1",
            email: "owner@example.com",
            googleAccessToken: "access-token",
            googleRefreshToken: "refresh-token",
            googleTokenExpiry: new Date(Date.now() + 60 * 60_000),
          },
        ],
        updateTokens: async () => {},
      },
    }));

    const GoogleCalendarProvider = await importProvider();
    const provider = new GoogleCalendarProvider();

    const events = await provider.listMeetingEvents({
      organizerEmails: [],
      timeMin: new Date(),
      timeMax: new Date(),
    });

    expect(events).toHaveLength(1);
    expect(events[0].ownerUserId).toBe("user-1");
    expect(events[0].participantEmails).toEqual(["guest-a@example.com", "guest-b@example.com"]);
  });

  it("service-account fallback path (zero OAuth-connected users) yields events with no ownerUserId", async () => {
    mockGoogleapis();
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({
      client_email: "svc@example.com",
      private_key: "fake-key",
    });

    moduleMock.module("@meeting-bot/shared/repositories/CalendarAccountRepository", () => ({
      CalendarAccountRepository: {
        getCalendarEnabledUsers: async () => [],
        updateTokens: async () => {},
      },
    }));

    const GoogleCalendarProvider = await importProvider();
    const provider = new GoogleCalendarProvider();

    const events = await provider.listMeetingEvents({
      organizerEmails: [],
      timeMin: new Date(),
      timeMax: new Date(),
    });

    expect(events).toHaveLength(1);
    expect(events[0].ownerUserId).toBeUndefined();
  });
});

describe("GoogleCalendarProvider — polling failure logging", () => {
  // The poller runs every ~60s. Passing the raw GaxiosError to console.error
  // dumped its whole object graph — response, headers and a ~1 KB
  // `www-authenticate` scope string — on every cycle, which is what made the
  // deployment logs unreadable.
  function mockFailingCalendar(error: unknown) {
    moduleMock.module("googleapis", () => ({
      google: {
        auth: {
          OAuth2: class {
            setCredentials() {}
          },
          GoogleAuth: class {},
          JWT: class {},
        },
        calendar: () => ({
          events: {
            list: async () => {
              throw error;
            },
          },
        }),
      },
    }));
    moduleMock.module("@meeting-bot/shared/repositories/CalendarAccountRepository", () => ({
      CalendarAccountRepository: {
        getCalendarEnabledUsers: async () => [
          {
            id: "user-1",
            email: "owner@example.com",
            googleAccessToken: "access-token",
            googleRefreshToken: "refresh-token",
            googleTokenExpiry: new Date(Date.now() + 60 * 60_000),
          },
        ],
        updateTokens: async () => {},
      },
    }));
  }

  async function pollAndCaptureLog(error: unknown): Promise<unknown[]> {
    // No service-account credentials => the fallback returns [] and cannot add
    // console noise of its own.
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    delete process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
    mockFailingCalendar(error);

    const consoleSpy = spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const GoogleCalendarProvider = await importProvider();
      const events = await new GoogleCalendarProvider().listMeetingEvents({
        organizerEmails: [],
        timeMin: new Date(),
        timeMax: new Date(),
      });

      expect(events).toEqual([]);
      expect(consoleSpy).toHaveBeenCalledTimes(1);
      return consoleSpy.mock.calls[0] as unknown[];
    } finally {
      consoleSpy.mockRestore();
    }
  }

  it("logs one line with account, HTTP status and message — never the error object", async () => {
    const gaxiosLikeError = Object.assign(
      new Error("Request had insufficient authentication scopes."),
      {
        status: 403,
        response: {
          status: 403,
          headers: {
            "www-authenticate": `Bearer realm="https://accounts.google.com/", error="insufficient_scope", scope="${"https://www.googleapis.com/auth/calendar.readonly ".repeat(20)}"`,
          },
        },
      },
    );

    const args = await pollAndCaptureLog(gaxiosLikeError);

    expect(args).toHaveLength(1);
    expect(args[0]).toBe(
      "[GoogleCalendarProvider] OAuth polling failed for owner@example.com (HTTP 403): Request had insufficient authentication scopes.",
    );
  });

  it("omits the status segment when the error carries none", async () => {
    const args = await pollAndCaptureLog(new Error("socket hang up"));

    expect(args).toHaveLength(1);
    expect(args[0]).toBe("[GoogleCalendarProvider] OAuth polling failed for owner@example.com: socket hang up");
  });
});
