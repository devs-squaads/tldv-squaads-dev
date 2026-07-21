"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import type { CreateShareInput } from "@/integrations/sharing/types";
import { MeetingShareService } from "@/services/meetingShareService";

async function requireCallerId(): Promise<string> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }
  return session.user.id;
}

export async function createShareAction(input: CreateShareInput) {
  try {
    const callerId = await requireCallerId();
    const result = await MeetingShareService.createShare(input, callerId);
    return { success: true, share: result };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error creating share";
    return { success: false, error: message };
  }
}

export async function revokeShareAction(shareId: string) {
  try {
    const callerId = await requireCallerId();
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
