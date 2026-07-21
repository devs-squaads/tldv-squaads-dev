"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { MeetingAccessGrantService } from "@/services/meetingAccessGrantService";

async function requireCallerId(): Promise<string> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }
  return session.user.id;
}

export async function createGrantAction(input: {
  meetingId: string;
  granteeUserId: string;
  ttlMinutes?: number;
  noExpiry?: boolean;
}) {
  try {
    const callerId = await requireCallerId();
    const result = await MeetingAccessGrantService.createGrant({ callerId, ...input });
    return { success: true, grant: result };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error creating access grant";
    return { success: false, error: message };
  }
}

export async function revokeGrantAction(grantId: string) {
  try {
    const callerId = await requireCallerId();
    await MeetingAccessGrantService.revokeGrant({ callerId, grantId });
    return { success: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error revoking access grant";
    return { success: false, error: message };
  }
}

export async function listGrantsAction(meetingId: string) {
  try {
    const callerId = await requireCallerId();
    const grants = await MeetingAccessGrantService.listGrantsByMeetingId(callerId, meetingId);
    return { success: true, grants };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error listing access grants";
    return { success: false, error: message };
  }
}
