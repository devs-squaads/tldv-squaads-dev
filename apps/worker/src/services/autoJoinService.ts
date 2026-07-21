import { randomUUID } from "crypto";
import { getConfiguredCalendarProvider } from "@/integrations/calendar/CalendarProviderRegistry";
import { isSupportedMeetingUrl, normalizeMeetingUrl } from "@meeting-bot/shared/meetingProvider";
import { CalendarAccountRepository } from "@meeting-bot/shared/repositories/CalendarAccountRepository";
import { MeetingAccessGrantRepository } from "@meeting-bot/shared/repositories/MeetingAccessGrantRepository";
import { UserRepository } from "@meeting-bot/shared/repositories/UserRepository";
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

    // Events from the service-account fallback path (no OAuth-connected
    // users) have no resolvable owner — skip rather than fabricate one
    // (see spec/features/009-meeting-ownership-sharing/plan.md).
    if (!event.ownerUserId) {
      console.warn(
        `[autoJoinService] Skipping event ${event.eventId} — no resolvable owner (service-account fallback has no users.id to attribute)`,
      );
      continue;
    }

    const normalizedUrl = normalizeMeetingUrl(event.meetingUrl);
    const duration = startsAt && endsAt
      ? Math.max(1, Math.ceil((endsAt.getTime() - startsAt.getTime()) / 60_000))
      : defaultDurationMinutes;

    const botName = process.env.BOT_DEFAULT_NAME || "Squaads Assistant";
    const { id: meetingId, ownerId: resolvedOwnerId } = await queueMeetingRun({
      meetingUrl: normalizedUrl,
      botName,
      duration,
      ownerId: event.ownerUserId,
      participantEmails: event.participantEmails,
      sourceProvider: event.provider,
      sourceEventId: event.eventId,
      organizerEmail: event.organizerEmail || undefined,
      startsAt: startsAt || undefined,
      endsAt: endsAt || undefined,
    });
    enqueued += 1;

    // ADR-0007 exception: access is granted automatically here — unlike everywhere else in the
    // codebase, where only the meeting Owner can trigger a share — because nobody consciously
    // decided to record in this auto-join path, so "the Owner decides" has no one to apply to
    // (the Owner itself was decided by which poll won the insert race, not by choice). Scoped
    // only to auto-join meetings; manual paths (INVITE_BOT, dashboard/chat) stay suggestion-only.
    for (const rawEmail of event.participantEmails ?? []) {
      const email = rawEmail.trim().toLowerCase();
      if (!email) continue;

      try {
        const user = await UserRepository.findByEmail(email);
        if (!user || user.id === resolvedOwnerId) continue;

        const alreadyGranted = await MeetingAccessGrantRepository.existsForMeetingAndGrantee(meetingId, user.id);
        if (alreadyGranted) continue;

        await MeetingAccessGrantRepository.createDedupedForMeetingAndGrantee({
          id: randomUUID(),
          meetingId,
          ownerId: resolvedOwnerId,
          granteeUserId: user.id,
          expiresAt: null,
          revokedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      } catch (error) {
        // One participant's failure must not abort the rest of this event's attendees, nor the
        // rest of the poll batch's events.
        console.warn(
          `[autoJoinService] Failed to grant access for participant ${email} on meeting ${meetingId}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
  }

  return { polled: events.length, enqueued };
}
