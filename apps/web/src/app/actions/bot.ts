"use server";

import { MeetingService } from "@/services/meetingService";
import { requestMeetingReprocess, requestMeetingRetry, requestMeetingSummaryRefine } from "@/services/workerRecoveryClient";

export async function startBotAction(formData: {
  meetingUrl: string;
  botName: string;
  duration: number;
  provider?: string;
}) {
  const { meetingUrl, botName, duration, provider } = formData;
  const { id } = await MeetingService.enqueueMeeting({ meetingUrl, botName, duration, provider });
  return { success: true, id };
}

export async function reprocessMeetingAction(meetingId: string) {
  try {
    return await requestMeetingReprocess(meetingId);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: message };
  }
}

export async function deleteMeetingAction(meetingId: string) {
  try {
    const result = await MeetingService.deleteMeeting(meetingId);
    if (!result.success) return result;
    return result;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown deletion error";
    return { success: false, error: message };
  }
}

export async function retryMeetingAction(meetingId: string) {
  try {
    return await requestMeetingRetry(meetingId);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: message };
  }
}

export async function refineSummaryAction(meetingId: string, userPrompt: string) {
  try {
    return await requestMeetingSummaryRefine(meetingId, userPrompt);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: message };
  }
}
