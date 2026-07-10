import fs from "fs";
import { google, type calendar_v3 } from "googleapis";
import type { CalendarProvider } from "@/integrations/calendar/CalendarProvider";
import type { CalendarMeetingEvent } from "@/integrations/calendar/types";
import { CalendarAccountRepository } from "@meeting-bot/shared/repositories/CalendarAccountRepository";

function normalizeEmail(value?: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function parseEventDate(value?: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getCandidateMatchEmails(event: calendar_v3.Schema$Event): string[] {
  const organizer = normalizeEmail(event.organizer?.email || null);
  const creator = normalizeEmail(event.creator?.email || null);
  return [organizer, creator].filter((value): value is string => Boolean(value));
}

function extractMeetingUrl(event: calendar_v3.Schema$Event): string | null {
  if (event.hangoutLink) {
    return event.hangoutLink;
  }

  const entryPoints = event.conferenceData?.entryPoints || [];
  const conferenceUrl = entryPoints.find((ep) => ep.entryPointType === "video" && ep.uri)?.uri;
  if (conferenceUrl) {
    return conferenceUrl;
  }

  const blob = `${event.description || ""}\n${event.location || ""}`;
  const match = blob.match(
    /https:\/\/(?:meet\.google\.com|teams\.microsoft\.com|(?:[\w-]+\.)?zoom\.(?:us|com))\/[^\s"')]+/i
  );
  return match?.[0] || null;
}

export class GoogleCalendarProvider implements CalendarProvider {
  private static async getOAuth2ForUser(user: {
    id: string;
    googleAccessToken: string | null;
    googleRefreshToken: string | null;
    googleTokenExpiry: Date | null;
  }) {
    const oauth2 = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
    );

    oauth2.setCredentials({
      access_token: user.googleAccessToken || undefined,
      refresh_token: user.googleRefreshToken || undefined,
      expiry_date: user.googleTokenExpiry?.getTime() || undefined,
    });

    const expiryDate = user.googleTokenExpiry?.getTime() || 0;
    if (expiryDate < Date.now() + 5 * 60 * 1000 && user.googleRefreshToken) {
      const { credentials } = await oauth2.refreshAccessToken();
      oauth2.setCredentials(credentials);
      await CalendarAccountRepository.updateTokens(user.id, {
        accessToken: credentials.access_token || "",
        expiresAt: credentials.expiry_date
          ? Math.floor(credentials.expiry_date / 1000)
          : undefined,
        ...(credentials.refresh_token ? { refreshToken: credentials.refresh_token } : {}),
      });
    }

    return oauth2;
  }

  private static async getServiceAccountAuthClient() {
    const envCreds = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (envCreds) {
      return new google.auth.GoogleAuth({
        credentials: JSON.parse(envCreds),
        scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
      });
    }

    const credsFile = process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
    if (!credsFile) {
      return null;
    }

    const rawCreds = fs.readFileSync(credsFile, "utf-8");
    const creds = JSON.parse(rawCreds) as { client_email?: string; private_key?: string };
    if (!creds.client_email || !creds.private_key) {
      throw new Error("Invalid Google service account credentials");
    }

    const scopes = ["https://www.googleapis.com/auth/calendar.readonly"];
    const subject = process.env.GOOGLE_CALENDAR_IMPERSONATE_USER || undefined;
    return new google.auth.JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes,
      subject,
    });
  }

  private static eventMatchesOrganizer(
    event: calendar_v3.Schema$Event,
    organizerSet: Set<string>,
  ): { matches: boolean; organizerEmail: string | null } {
    const organizerEmail = normalizeEmail(event.organizer?.email || null);
    if (!organizerSet.size) {
      return { matches: true, organizerEmail };
    }

    const candidateEmails = getCandidateMatchEmails(event);
    const matches = candidateEmails.some((email) => organizerSet.has(email));
    return { matches, organizerEmail };
  }

  private static async fetchEvents(
    auth: calendar_v3.Options["auth"],
    params: {
      organizerEmails: string[];
      timeMin: Date;
      timeMax: Date;
    },
    calendarId: string,
  ): Promise<CalendarMeetingEvent[]> {
    const calendar = google.calendar({ version: "v3", auth });
    const organizerSet = new Set(params.organizerEmails.map((email) => email.toLowerCase()));

    const response = await calendar.events.list({
      calendarId,
      timeMin: params.timeMin.toISOString(),
      timeMax: params.timeMax.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 250,
    });

    const items = response.data.items || [];
    const mapped: CalendarMeetingEvent[] = [];

    for (const event of items) {
      const eventId = event.id || "";
      if (!eventId) continue;

      const { matches, organizerEmail } = GoogleCalendarProvider.eventMatchesOrganizer(event, organizerSet);
      if (!matches) continue;

      const meetingUrl = extractMeetingUrl(event);
      if (!meetingUrl) continue;

      mapped.push({
        provider: "google-calendar",
        eventId,
        organizerEmail,
        summary: event.summary || null,
        meetingUrl,
        startsAt: parseEventDate(event.start?.dateTime || event.start?.date),
        endsAt: parseEventDate(event.end?.dateTime || event.end?.date),
      });
    }

    return mapped;
  }

  async listMeetingEvents(params: {
    organizerEmails: string[];
    timeMin: Date;
    timeMax: Date;
  }): Promise<CalendarMeetingEvent[]> {
    const meetings: CalendarMeetingEvent[] = [];
    const oauthUsers = await CalendarAccountRepository.getCalendarEnabledUsers().catch(() => []);

    for (const user of oauthUsers) {
      if (!user.googleAccessToken) continue;
      try {
        const auth = await GoogleCalendarProvider.getOAuth2ForUser(user);
        meetings.push(...(await GoogleCalendarProvider.fetchEvents(auth, params, "primary")));
      } catch (error) {
        console.error(`[GoogleCalendarProvider] OAuth polling failed for ${user.email}:`, error);
      }
    }

    if (!meetings.length) {
      const auth = await GoogleCalendarProvider.getServiceAccountAuthClient();
      if (!auth) {
        return [];
      }

      meetings.push(
        ...(await GoogleCalendarProvider.fetchEvents(
          auth,
          params,
          process.env.GOOGLE_CALENDAR_ID || "primary",
        ))
      );
    }

    const seen = new Set<string>();
    return meetings.filter((meeting) => {
      const dedupeKey = `${meeting.eventId}:${meeting.meetingUrl}`;
      if (seen.has(dedupeKey)) {
        return false;
      }
      seen.add(dedupeKey);
      return true;
    });
  }
}
