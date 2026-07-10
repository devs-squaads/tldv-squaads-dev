import { getConfiguredCalendarProvider } from "@/integrations/calendar/CalendarProviderRegistry";
import { isSupportedMeetingUrl, normalizeMeetingUrl } from "@meeting-bot/shared/meetingProvider";
import { CalendarAccountRepository } from "@meeting-bot/shared/repositories/CalendarAccountRepository";
import { queueMeetingRun } from "@meeting-bot/shared/services/meetingQueueService";

function parseNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number(raw) : fallback;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseOrganizerEmails(): string[] {
  const raw = process.env.AUTO_JOIN_ORGANIZER_EMAILS || "";
  return raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export async function autoJoinPollAndEnqueue(): Promise<{ polled: number; enqueued: number }> {
  const organizerEmails = parseOrganizerEmails();
  const oauthUsers = await CalendarAccountRepository.getCalendarEnabledUsers().catch(() => []);
  const hasOAuthUsers = oauthUsers.length > 0;

  if (!hasOAuthUsers && process.env.AUTO_JOIN_ENABLED !== "true") {
    return { polled: 0, enqueued: 0 };
  }
  if (!hasOAuthUsers && !organizerEmails.length) {
    return { polled: 0, enqueued: 0 };
  }

  const leadMinutes = parseNumberEnv("AUTO_JOIN_LEAD_TIME_MINUTES", 1);
  const lookbackMinutes = parseNumberEnv("AUTO_JOIN_LOOKBACK_MINUTES", 5);
  const lookaheadMinutes = parseNumberEnv("AUTO_JOIN_LOOKAHEAD_MINUTES", 30);
  const defaultDurationMinutes = parseNumberEnv("AUTO_JOIN_DEFAULT_DURATION_MINUTES", 60);
  const now = new Date();

  const provider = getConfiguredCalendarProvider();
  const events = await provider.listMeetingEvents({
    organizerEmails,
    timeMin: new Date(now.getTime() - lookbackMinutes * 60_000),
    timeMax: new Date(now.getTime() + lookaheadMinutes * 60_000),
  });

  let enqueued = 0;
  for (const event of events) {
    if (process.env.AUTO_JOIN_REQUIRE_SUPPORTED_LINK !== "false" && !isSupportedMeetingUrl(event.meetingUrl)) {
      continue;
    }

    const startsAt = event.startsAt;
    const endsAt = event.endsAt;
    const eligibleByTime = !startsAt || startsAt.getTime() <= now.getTime() + leadMinutes * 60_000;
    const notExpired = !endsAt || endsAt.getTime() > now.getTime();
    if (!eligibleByTime || !notExpired) continue;

    const normalizedUrl = normalizeMeetingUrl(event.meetingUrl);
    const duration = startsAt && endsAt
      ? Math.max(1, Math.ceil((endsAt.getTime() - startsAt.getTime()) / 60_000))
      : defaultDurationMinutes;

    const botName = process.env.BOT_DEFAULT_NAME || "Squaads Assistant";
    await queueMeetingRun({
      meetingUrl: normalizedUrl,
      botName,
      duration,
      sourceProvider: event.provider,
      sourceEventId: event.eventId,
      organizerEmail: event.organizerEmail || undefined,
      startsAt: startsAt || undefined,
      endsAt: endsAt || undefined,
    });
    enqueued += 1;
  }

  return { polled: events.length, enqueued };
}
