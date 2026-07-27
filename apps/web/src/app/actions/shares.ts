"use server";

import { requireCaller } from "@/lib/sessionCaller";
import type { CreateShareInput } from "@/integrations/sharing/types";
import { MeetingShareService } from "@/services/meetingShareService";

export async function createShareAction(input: CreateShareInput) {
  try {
    const { id: callerId } = await requireCaller();
    const result = await MeetingShareService.createShare(input, callerId);
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
