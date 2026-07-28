import { randomUUID } from "crypto";
import { MeetingRepository } from "@meeting-bot/shared/repositories/MeetingRepository";
import { MeetingShareRequestRepository } from "@meeting-bot/shared/repositories/MeetingShareRequestRepository";
import type { MeetingShareRequestRecord } from "@meeting-bot/shared/repositories/MeetingShareRequestRepository";
import type { SessionCaller } from "@/lib/sessionCaller";
import { MeetingAccessGrantService } from "@/services/meetingAccessGrantService";
import { MeetingShareService } from "@/services/meetingShareService";
import { normalizeEmail } from "@/integrations/sharing/utils";

export type ShareRequestRecord = MeetingShareRequestRecord;
export type ShareRequestListItem = MeetingShareRequestRecord;
export type ShareRequestAccessType = MeetingShareRequestRecord["accessType"];

export interface CreateShareRequestInput {
  callerId: string;
  meetingId: string;
  recipient: { granteeUserId: string } | { email: string };
  accessType: ShareRequestAccessType;
  expiresInDays?: number; // temporary only; UI pre-fills 15
}

// Translates the request's proposed access type into the ttlMinutes/noExpiry pair the
// existing createGrant/createShare contracts already accept — permanent and single_use are
// both time-unbounded (single_use dies on first verify instead, ADR-0008), only temporary
// carries a day-based expiry.
function resolveTtlFromAccessType(
  accessType: ShareRequestAccessType,
  expiresInDays: number | null
): { ttlMinutes?: number; noExpiry?: boolean } {
  if (accessType === "temporary") {
    return { ttlMinutes: (expiresInDays ?? 0) * 1440 };
  }
  return { noExpiry: true };
}

export class ShareRequestService {
  static async createShareRequest(input: CreateShareRequestInput): Promise<ShareRequestRecord> {
    const meeting = await MeetingRepository.findById(input.meetingId);
    if (!meeting) {
      throw new Error("Meeting not found");
    }
    if (meeting.ownerId !== input.callerId) {
      throw new Error("Only the meeting owner can request a share");
    }

    const recipient = input.recipient;
    const isRegistered = "granteeUserId" in recipient;
    if (input.accessType === "single_use" && isRegistered) {
      throw new Error("single_use access is only available for unregistered recipients");
    }
    if (input.accessType === "temporary" && !input.expiresInDays) {
      throw new Error("expiresInDays is required for temporary access");
    }

    const recipientFields = "granteeUserId" in recipient
      ? { granteeUserId: recipient.granteeUserId, recipientEmail: null, recipientEmailNormalized: null }
      : {
          granteeUserId: null,
          recipientEmail: recipient.email.trim(),
          recipientEmailNormalized: normalizeEmail(recipient.email),
        };

    const now = new Date();
    const record: ShareRequestRecord = {
      id: randomUUID(),
      meetingId: meeting.id,
      requesterId: input.callerId,
      ...recipientFields,
      accessType: input.accessType,
      expiresInDays: input.accessType === "temporary" ? (input.expiresInDays as number) : null,
      status: "pending",
      resolvedBy: null,
      resolvedAt: null,
      resolvedGrantId: null,
      resolvedShareId: null,
      createdAt: now,
      updatedAt: now,
    };

    // Insert-is-the-arbiter (ADR-0007 idiom, mirrored by the partial unique indexes): a
    // duplicate pending request for the same recipient surfaces as a rejected DB write here,
    // no app-level pre-check needed.
    await MeetingShareRequestRepository.create(record);
    return record;
  }

  static async cancelShareRequest(callerId: string, requestId: string): Promise<void> {
    const request = await MeetingShareRequestRepository.findById(requestId);
    if (!request) {
      throw new Error("Share request not found");
    }
    if (request.requesterId !== callerId) {
      throw new Error("Only the requester can cancel this share request");
    }
    // Atomic gate: the guarded UPDATE (WHERE status = 'pending') is the race arbiter, not this
    // findById's status field — a concurrent cancel/approve/reject can flip it between the read
    // above and this write.
    const cancelled = await MeetingShareRequestRepository.cancel(requestId);
    if (!cancelled) {
      throw new Error("Only a pending share request can be cancelled");
    }
  }

  static async approveShareRequest(caller: SessionCaller, requestId: string): Promise<void> {
    if (caller.role !== "admin") {
      throw new Error("Only an admin can approve a share request");
    }
    const request = await this.requireExisting(requestId);

    const ttl = resolveTtlFromAccessType(request.accessType, request.expiresInDays);

    // Atomic gate FIRST, before any downstream grant/share creation or email send: the guarded
    // UPDATE (WHERE status = 'pending') is the race arbiter. Only the winner of a concurrent
    // approve/reject/cancel race reaches the side effects below.
    const resolved = await MeetingShareRequestRepository.resolve(requestId, {
      status: "approved",
      resolvedBy: caller.id,
    });
    if (!resolved) {
      throw new Error("Only a pending share request can be approved");
    }

    if (request.granteeUserId) {
      // 013/Phase 4.2: accessType + expiresInDays are passed through additively (alongside the
      // legacy ttl spread below) so createGrant's own accessType mapping bypasses shareTtl.ts's
      // fixed TTL menu for arbitrary day counts — closes the gap flagged when this branch only
      // had ttlMinutes/noExpiry to work with (PR2).
      const grant = await MeetingAccessGrantService.createGrant({
        callerId: request.requesterId,
        meetingId: request.meetingId,
        granteeUserId: request.granteeUserId,
        accessType: request.accessType,
        expiresInDays: request.expiresInDays ?? undefined,
        ...ttl,
      });
      // Status is already terminal at this point (only the winning caller gets here), so this
      // follow-up write is a plain by-id update, not another race.
      await MeetingShareRequestRepository.attachResolutionRef(requestId, { resolvedGrantId: grant.id });
      return;
    }

    // singleUse is passed through for CreateShareInput to honor once Phase 4 (013-04) wires
    // singleUse into the type + persistence; the current createShare simply ignores unknown
    // properties on its input until then.
    // 013/Phase 4.2 follow-up (PR3 fix): accessType + expiresInDays are passed through
    // additively (alongside the legacy ttl spread below) so createShare's own accessType
    // mapping bypasses shareTtl.ts's fixed TTL menu for arbitrary day counts — closes the gap
    // flagged when this branch only had ttlMinutes/noExpiry to work with (PR3, mirrors the
    // registered-recipient branch's identical fix above). accessType stays "single_use"-safe:
    // createShare only routes temporary/permanent through this mechanism, so it never
    // conflicts with the singleUse field set above.
    const shareInput = {
      meetingId: request.meetingId,
      shareType: "restricted_email" as const,
      recipientEmail: request.recipientEmail ?? undefined,
      singleUse: request.accessType === "single_use",
      accessType: request.accessType,
      expiresInDays: request.expiresInDays ?? undefined,
      ...ttl,
    };
    const share = await MeetingShareService.createShare(shareInput, request.requesterId);
    await MeetingShareRequestRepository.attachResolutionRef(requestId, { resolvedShareId: share.id });
  }

  static async rejectShareRequest(caller: SessionCaller, requestId: string): Promise<void> {
    if (caller.role !== "admin") {
      throw new Error("Only an admin can reject a share request");
    }
    await this.requireExisting(requestId);

    const resolved = await MeetingShareRequestRepository.resolve(requestId, {
      status: "rejected",
      resolvedBy: caller.id,
    });
    if (!resolved) {
      throw new Error("Only a pending share request can be rejected");
    }
  }

  // Owner-gated (the requester in practice — only member Owners create requests). Only a
  // resolved (non-pending) request may be deleted; pending stays cancel/approve/reject-only.
  static async deleteShareRequest(requestId: string, callerId?: string): Promise<void> {
    const request = await MeetingShareRequestRepository.findById(requestId);
    if (!request) {
      throw new Error("Share request not found");
    }
    if (callerId !== undefined && request.requesterId !== callerId) {
      throw new Error("Only the requester can delete this share request");
    }
    if (request.status === "pending") {
      throw new Error("Only a resolved share request can be deleted");
    }
    await MeetingShareRequestRepository.deleteById(requestId);
  }

  // Mirrors MeetingShareService.clearInactiveShares's shape/return type.
  static async clearResolvedShareRequests(meetingId: string, callerId?: string): Promise<{ deletedCount: number }> {
    if (callerId !== undefined) {
      const meeting = await MeetingRepository.findById(meetingId);
      if (!meeting || meeting.ownerId !== callerId) {
        throw new Error("Only the meeting owner can clear share requests");
      }
    }
    const deletedCount = await MeetingShareRequestRepository.deleteResolvedByMeetingId(meetingId);
    return { deletedCount };
  }

  static async listPending(): Promise<ShareRequestListItem[]> {
    return MeetingShareRequestRepository.listPending();
  }

  static async countPending(): Promise<number> {
    return MeetingShareRequestRepository.countPending();
  }

  static async listByMeetingId(callerId: string, meetingId: string): Promise<ShareRequestRecord[]> {
    const meeting = await MeetingRepository.findById(meetingId);
    if (!meeting) {
      throw new Error("Meeting not found");
    }
    if (meeting.ownerId !== callerId) {
      throw new Error("Only the meeting owner can view share requests");
    }
    return MeetingShareRequestRepository.listByMeetingId(meetingId);
  }

  // Existence guard for approve/reject, used to fetch the immutable request data (accessType,
  // recipient, requesterId) needed to build the downstream grant/share. The pending check itself
  // is NOT done here — it's the atomic resolve() gate in the caller, since a plain status read
  // here would be racy against a concurrent approve/reject/cancel.
  private static async requireExisting(requestId: string): Promise<ShareRequestRecord> {
    const request = await MeetingShareRequestRepository.findById(requestId);
    if (!request) {
      throw new Error("Share request not found");
    }
    return request;
  }
}
