"use server";

import { requireCaller } from "@/lib/sessionCaller";
import type { CreateShareInput } from "@/integrations/sharing/types";
import { MeetingShareService } from "@/services/meetingShareService";
import { ShareRequestService } from "@/services/shareRequestService";
import type { ShareRequestAccessType } from "@/services/shareRequestService";

export async function createShareAction(
  input: CreateShareInput & { accessType?: ShareRequestAccessType; expiresInDays?: number }
) {
  try {
    const { id: callerId, role } = await requireCaller();
    // 013: member Owner → pending Share Request (no downstream row, no email); admin Owner →
    // direct create, unchanged from 009 (revoke stays direct for both roles, below).
    if (role === "member") {
      if (!input.recipientEmail?.trim()) {
        throw new Error("recipientEmail is required to request a share");
      }
      const request = await ShareRequestService.createShareRequest({
        callerId,
        meetingId: input.meetingId,
        recipient: { email: input.recipientEmail },
        accessType: input.accessType ?? "permanent",
        expiresInDays: input.expiresInDays,
      });
      return { success: true, shareRequest: request };
    }

    const result = await MeetingShareService.createShare(input, callerId, role);
    return { success: true, share: result };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error creating share";
    return { success: false, error: message };
  }
}

export async function revokeShareAction(shareId: string) {
  try {
    const { id: callerId } = await requireCaller();
    await MeetingShareService.revokeShare(shareId, callerId);
    return { success: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error revoking share";
    return { success: false, error: message };
  }
}

export async function resendShareInviteAction(shareId: string) {
  try {
    const result = await MeetingShareService.regenerateShareLink(shareId);
    return { success: true, ...result };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error resending share invite";
    return { success: false, error: message };
  }
}

export async function renewShareAccessAction(input: { shareId: string; ttlMinutes?: number; noExpiry?: boolean }) {
  try {
    const result = await MeetingShareService.renewShareAccess(input.shareId, {
      ttlMinutes: input.ttlMinutes,
      noExpiry: input.noExpiry,
    });
    return { success: true, ...result };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error renewing share access";
    return { success: false, error: message };
  }
}

export async function clearInactiveSharesAction(meetingId: string) {
  try {
    const result = await MeetingShareService.clearInactiveShares(meetingId);
    return { success: true, ...result };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error clearing inactive shares";
    return { success: false, error: message };
  }
}

export async function deleteShareAction(shareId: string) {
  try {
    const { id: callerId } = await requireCaller();
    await MeetingShareService.deleteShare(shareId, callerId);
    return { success: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error deleting share";
    return { success: false, error: message };
  }
}
