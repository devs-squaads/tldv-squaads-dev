"use server";

import { requireCaller } from "@/lib/sessionCaller";
import { MeetingAccessGrantService } from "@/services/meetingAccessGrantService";
import { ShareRequestService } from "@/services/shareRequestService";
import type { ShareRequestAccessType } from "@/services/shareRequestService";

export async function createGrantAction(input: {
  meetingId: string;
  granteeUserId: string;
  ttlMinutes?: number;
  noExpiry?: boolean;
  accessType?: ShareRequestAccessType;
  expiresInDays?: number;
}) {
  try {
    const { id: callerId, role } = await requireCaller();
    // 013: member Owner → pending Share Request (no downstream row, no email); admin Owner →
    // direct create, unchanged from 009 (revoke stays direct for both roles, below).
    if (role === "member") {
      const request = await ShareRequestService.createShareRequest({
        callerId,
        meetingId: input.meetingId,
        recipient: { granteeUserId: input.granteeUserId },
        accessType: input.accessType ?? "permanent",
        expiresInDays: input.expiresInDays,
      });
      return { success: true, shareRequest: request };
    }

    const result = await MeetingAccessGrantService.createGrant({ callerId, callerRole: role, ...input });
    return { success: true, grant: result };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error creating access grant";
    return { success: false, error: message };
  }
}

export async function revokeGrantAction(grantId: string) {
  try {
    const { id: callerId } = await requireCaller();
    await MeetingAccessGrantService.revokeGrant({ callerId, grantId });
    return { success: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error revoking access grant";
    return { success: false, error: message };
  }
}

export async function listGrantsAction(meetingId: string) {
  try {
    const { id: callerId } = await requireCaller();
    const grants = await MeetingAccessGrantService.listGrantsByMeetingId(callerId, meetingId);
    return { success: true, grants };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error listing access grants";
    return { success: false, error: message };
  }
}
