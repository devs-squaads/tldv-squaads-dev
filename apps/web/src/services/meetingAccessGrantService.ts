import { randomUUID } from "crypto";
import { MeetingRepository } from "@meeting-bot/shared/repositories/MeetingRepository";
import type { MeetingRecord } from "@meeting-bot/shared/repositories/MeetingRepository";
import { MeetingAccessGrantRepository } from "@meeting-bot/shared/repositories/MeetingAccessGrantRepository";
import type { MeetingAccessGrantRecord } from "@meeting-bot/shared/repositories/MeetingAccessGrantRepository";
import { resolveExpiresAt } from "@/integrations/sharing/shareTtl";

export type GrantAccessType = "single_use" | "temporary" | "permanent";

export interface CreateGrantInput {
  callerId: string;
  meetingId: string;
  granteeUserId: string;
  ttlMinutes?: number;
  noExpiry?: boolean;
  // 013: proposed by a Share Request approval, or picked directly by an admin. Takes
  // priority over ttlMinutes/noExpiry above when present — see resolveExpiresAtFromAccessType.
  accessType?: GrantAccessType;
  expiresInDays?: number; // required when accessType === "temporary"
  callerRole?: "admin" | "member"; // member direct-create throws; undefined = M2M unchanged
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

// 013: accessType maps straight to an expiry, deliberately bypassing shareTtl.ts's fixed
// TTL-menu validation (1h/1d/7d) used by the legacy ttlMinutes/noExpiry path above — Share
// Request approvals (and admin-direct temporary grants) need any day count, per spec's
// "temporary MUST let the Owner set any day count" requirement.
function resolveExpiresAtFromAccessType(accessType: GrantAccessType, expiresInDays?: number): Date | null {
  if (accessType === "single_use") {
    throw new Error("single_use access is only available for unregistered recipients");
  }
  if (accessType === "permanent") {
    return null;
  }
  if (!expiresInDays || expiresInDays <= 0) {
    throw new Error("expiresInDays is required for temporary access");
  }
  return new Date(Date.now() + expiresInDays * 1440 * 60 * 1000);
}

export class MeetingAccessGrantService {
  static async createGrant(input: CreateGrantInput): Promise<{ id: string; expiresAt: Date | null }> {
    if (input.callerRole === "member") {
      throw new Error("Member owners must submit a share request for admin approval");
    }
    const meeting = await requireOwnedMeeting(input.meetingId, input.callerId);

    const expiresAt = input.accessType
      ? resolveExpiresAtFromAccessType(input.accessType, input.expiresInDays)
      : resolveExpiresAt(input.ttlMinutes, input.noExpiry);
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

  // Owner-gated, mirrors MeetingShareService.deleteShare's shape. Only a revoked/expired grant
  // may be deleted — an active one must be revoked first.
  static async deleteGrant(grantId: string, callerId?: string): Promise<void> {
    const grant = await MeetingAccessGrantRepository.findById(grantId);
    if (!grant) {
      throw new Error("Access grant not found");
    }
    if (callerId !== undefined && grant.ownerId !== callerId) {
      throw new Error("Only the meeting owner can manage access grants");
    }
    const isActive = !grant.revokedAt && (!grant.expiresAt || grant.expiresAt.getTime() > Date.now());
    if (isActive) {
      throw new Error("Only a revoked or expired access grant can be deleted");
    }
    await MeetingAccessGrantRepository.deleteById(grantId);
  }

  // Mirrors MeetingShareService.clearInactiveShares's shape/return type.
  static async clearInactiveGrants(meetingId: string, callerId?: string): Promise<{ deletedCount: number }> {
    if (callerId !== undefined) {
      await requireOwnedMeeting(meetingId, callerId);
    }
    const deletedCount = await MeetingAccessGrantRepository.deleteInactiveByMeetingId(meetingId, new Date());
    return { deletedCount };
  }
}
