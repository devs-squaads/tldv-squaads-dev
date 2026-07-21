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

export async function queueMeetingRun(params: StartMeetingParams): Promise<{ id: string; ownerId: string }> {
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
    const values = {
      id,
      botName,
      url: normalizedMeetingUrl,
      ownerId,
      participantEmails: participantEmails ?? null,
      sourceProvider: sourceProvider ?? null,
      sourceEventId: sourceEventId ?? null,
      organizerEmail: organizerEmail ?? null,
      status: "pending" as const,
      startsAt: startsAt ?? null,
      endsAt: endsAt ?? null,
      durationMinutes: duration,
      createdAt: now,
      updatedAt: now,
    };

    if (sourceProvider && sourceEventId) {
      // DB-level dedup: relies on the partial unique index on (source_provider,
      // source_event_id) — a concurrent poll racing here resolves to the same
      // winning row instead of a racy findBySourceEvent-then-insert check.
      const record = await MeetingRepository.insertDedupedBySourceEvent(values);
      return { id: record.id, ownerId: record.ownerId };
    }

    const dedupeWindowMs = 10 * 60 * 1000;
    const dedupeThreshold = new Date(now.getTime() - dedupeWindowMs);
    const existing = await MeetingRepository.findActiveByUrlCreatedAfter(normalizedMeetingUrl, dedupeThreshold);

    if (existing?.id) {
      return { id: existing.id, ownerId: existing.ownerId };
    }

    await MeetingRepository.insert(values);
  }

  return { id, ownerId };
}
