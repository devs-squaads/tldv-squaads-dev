import { afterEach, describe, expect, it, mock } from "bun:test";

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
