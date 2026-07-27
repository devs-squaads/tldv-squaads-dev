import { randomUUID } from "crypto";
import { MeetingRepository } from "@meeting-bot/shared/repositories/MeetingRepository";
import { MeetingShareRequestRepository } from "@meeting-bot/shared/repositories/MeetingShareRequestRepository";
import type {
  MeetingShareRequestRecord,
  MeetingShareRequestStatus,
} from "@meeting-bot/shared/repositories/MeetingShareRequestRepository";
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
    if (request.status !== "pending") {
      throw new Error("Only a pending share request can be cancelled");
    }
    await MeetingShareRequestRepository.cancel(requestId);
  }

  static async approveShareRequest(caller: SessionCaller, requestId: string): Promise<void> {
    if (caller.role !== "admin") {
      throw new Error("Only an admin can approve a share request");
    }
    const request = await this.requirePending(requestId, "approved");

    const ttl = resolveTtlFromAccessType(request.accessType, request.expiresInDays);

    if (request.granteeUserId) {
      const grant = await MeetingAccessGrantService.createGrant({
        callerId: request.requesterId,
        meetingId: request.meetingId,
        granteeUserId: request.granteeUserId,
        ...ttl,
      });
      await MeetingShareRequestRepository.resolve(requestId, {
        status: "approved",
        resolvedBy: caller.id,
        resolvedGrantId: grant.id,
      });
      return;
    }

    // singleUse is passed through for CreateShareInput to honor once Phase 4 (013-04) wires
    // singleUse into the type + persistence; the current createShare simply ignores unknown
    // properties on its input until then.
    const shareInput = {
      meetingId: request.meetingId,
      shareType: "restricted_email" as const,
      recipientEmail: request.recipientEmail ?? undefined,
      singleUse: request.accessType === "single_use",
      ...ttl,
    };
    const share = await MeetingShareService.createShare(shareInput, request.requesterId);
    await MeetingShareRequestRepository.resolve(requestId, {
      status: "approved",
      resolvedBy: caller.id,
      resolvedShareId: share.id,
    });
  }

  static async rejectShareRequest(caller: SessionCaller, requestId: string): Promise<void> {
    if (caller.role !== "admin") {
      throw new Error("Only an admin can reject a share request");
    }
    await this.requirePending(requestId, "rejected");

    await MeetingShareRequestRepository.resolve(requestId, {
      status: "rejected",
      resolvedBy: caller.id,
    });
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

  // Shared pending-lookup + terminal-state guard for approve/reject; verb only affects the error text.
  private static async requirePending(
    requestId: string,
    verb: Extract<MeetingShareRequestStatus, "approved" | "rejected">
  ): Promise<ShareRequestRecord> {
    const request = await MeetingShareRequestRepository.findById(requestId);
    if (!request) {
      throw new Error("Share request not found");
    }
    if (request.status !== "pending") {
      throw new Error(`Only a pending share request can be ${verb === "approved" ? "approved" : "rejected"}`);
    }
    return request;
  }
}
