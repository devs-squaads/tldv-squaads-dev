"use server";

import { requireCaller } from "@/lib/sessionCaller";
import { MeetingAccessGrantService } from "@/services/meetingAccessGrantService";

export async function createGrantAction(input: {
  meetingId: string;
  granteeUserId: string;
  ttlMinutes?: number;
  noExpiry?: boolean;
}) {
  try {
    const { id: callerId } = await requireCaller();
    const result = await MeetingAccessGrantService.createGrant({ callerId, ...input });
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
