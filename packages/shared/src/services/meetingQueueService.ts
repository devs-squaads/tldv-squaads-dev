import { randomUUID } from "crypto";
import { normalizeMeetingUrl } from "@meeting-bot/shared/meetingProvider";
import { MeetingRepository } from "@meeting-bot/shared/repositories/MeetingRepository";

export interface StartMeetingParams {
  meetingUrl: string;
  botName: string;
  duration: number;
  ownerId: string;
  participantEmails?: string[];
  providerHint?: string;
  meetingId?: string;
  sourceProvider?: string;
  sourceEventId?: string;
  organizerEmail?: string;
  startsAt?: Date;
  endsAt?: Date;
}

export async function queueMeetingRun(params: StartMeetingParams): Promise<{ id: string }> {
  const {
    meetingUrl,
    botName,
    duration,
    ownerId,
    participantEmails,
    providerHint,
    meetingId,
    sourceProvider,
    sourceEventId,
    organizerEmail,
    startsAt,
    endsAt,
  } = params;
  const normalizedMeetingUrl = normalizeMeetingUrl(meetingUrl, providerHint);
  const id = meetingId || randomUUID();
  const now = new Date();

  if (!meetingId) {
    if (sourceProvider && sourceEventId) {
      const existingBySource = await MeetingRepository.findBySourceEvent(sourceProvider, sourceEventId);
      if (existingBySource?.id) {
        return { id: existingBySource.id };
      }
    }

    const dedupeWindowMs = 10 * 60 * 1000;
    const dedupeThreshold = new Date(now.getTime() - dedupeWindowMs);
    const existing = await MeetingRepository.findActiveByUrlCreatedAfter(normalizedMeetingUrl, dedupeThreshold);

    if (existing?.id) {
      return { id: existing.id };
    }

    await MeetingRepository.insert({
      id,
      botName,
      url: normalizedMeetingUrl,
      ownerId,
      participantEmails: participantEmails ?? null,
      sourceProvider: sourceProvider ?? null,
      sourceEventId: sourceEventId ?? null,
      organizerEmail: organizerEmail ?? null,
      status: "pending",
      startsAt: startsAt ?? null,
      endsAt: endsAt ?? null,
      durationMinutes: duration,
      createdAt: now,
      updatedAt: now,
    });
  }

  return { id };
}
