import { randomUUID } from "crypto";
import { MeetingRepository } from "@meeting-bot/shared/repositories/MeetingRepository";
import type { MeetingRecord } from "@meeting-bot/shared/repositories/MeetingRepository";
import { MeetingAccessGrantRepository } from "@meeting-bot/shared/repositories/MeetingAccessGrantRepository";
import type { MeetingAccessGrantRecord } from "@meeting-bot/shared/repositories/MeetingAccessGrantRepository";
import { resolveExpiresAt } from "@/integrations/sharing/shareTtl";

export interface CreateGrantInput {
  callerId: string;
  meetingId: string;
  granteeUserId: string;
  ttlMinutes?: number;
  noExpiry?: boolean;
}

export interface RevokeGrantInput {
  callerId: string;
  grantId: string;
}

// Ownership gate shared by create/list/revoke — a grantee is never the
// meeting's ownerId, so this same check also blocks re-sharing chains.
async function requireOwnedMeeting(meetingId: string, callerId: string): Promise<MeetingRecord> {
  const meeting = await MeetingRepository.findById(meetingId);
  if (!meeting) {
    throw new Error("Meeting not found");
  }
  if (meeting.ownerId !== callerId) {
    throw new Error("Only the meeting owner can manage access grants");
  }
  return meeting;
}

export class MeetingAccessGrantService {
  static async createGrant(input: CreateGrantInput): Promise<{ id: string; expiresAt: Date | null }> {
    const meeting = await requireOwnedMeeting(input.meetingId, input.callerId);

    const expiresAt = resolveExpiresAt(input.ttlMinutes, input.noExpiry);
    const now = new Date();
    const id = randomUUID();

    const persisted = await MeetingAccessGrantRepository.upsertActive({
      id,
      meetingId: meeting.id,
      ownerId: meeting.ownerId,
      granteeUserId: input.granteeUserId,
      expiresAt,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    return { id: persisted.id, expiresAt: persisted.expiresAt };
  }

  static async listGrantsByMeetingId(callerId: string, meetingId: string): Promise<MeetingAccessGrantRecord[]> {
    await requireOwnedMeeting(meetingId, callerId);
    return MeetingAccessGrantRepository.listByMeetingId(meetingId);
  }

  static async revokeGrant(input: RevokeGrantInput): Promise<void> {
    const grant = await MeetingAccessGrantRepository.findById(input.grantId);
    if (!grant) {
      throw new Error("Access grant not found");
    }
    if (grant.ownerId !== input.callerId) {
      throw new Error("Only the meeting owner can manage access grants");
    }
    await MeetingAccessGrantRepository.revokeById(input.grantId);
  }
}
