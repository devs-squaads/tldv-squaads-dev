"use server";

import { requireCaller } from "@/lib/sessionCaller";
import { ShareRequestService } from "@/services/shareRequestService";
import type { CreateShareRequestInput } from "@/services/shareRequestService";

export async function createShareRequestAction(input: Omit<CreateShareRequestInput, "callerId">) {
  try {
    const { id: callerId } = await requireCaller();
    const request = await ShareRequestService.createShareRequest({ callerId, ...input });
    return { success: true, shareRequest: request };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error creating share request";
    return { success: false, error: message };
  }
}

export async function cancelShareRequestAction(requestId: string) {
  try {
    const { id: callerId } = await requireCaller();
    await ShareRequestService.cancelShareRequest(callerId, requestId);
    return { success: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error cancelling share request";
    return { success: false, error: message };
  }
}

export async function approveShareRequestAction(requestId: string) {
  try {
    const caller = await requireCaller();
    await ShareRequestService.approveShareRequest(caller, requestId);
    return { success: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error approving share request";
    return { success: false, error: message };
  }
}

export async function rejectShareRequestAction(requestId: string) {
  try {
    const caller = await requireCaller();
    await ShareRequestService.rejectShareRequest(caller, requestId);
    return { success: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error rejecting share request";
    return { success: false, error: message };
  }
}

export async function deleteShareRequestAction(requestId: string) {
  try {
    const { id: callerId } = await requireCaller();
    await ShareRequestService.deleteShareRequest(requestId, callerId);
    return { success: true };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error deleting share request";
    return { success: false, error: message };
  }
}

export async function clearResolvedShareRequestsAction(meetingId: string) {
  try {
    const { id: callerId } = await requireCaller();
    const result = await ShareRequestService.clearResolvedShareRequests(meetingId, callerId);
    return { success: true, ...result };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error clearing resolved share requests";
    return { success: false, error: message };
  }
}

export async function listShareRequestsByMeetingIdAction(meetingId: string) {
  try {
    const { id: callerId } = await requireCaller();
    const requests = await ShareRequestService.listByMeetingId(callerId, meetingId);
    return { success: true, requests };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error listing share requests";
    return { success: false, error: message };
  }
}

// Admin-only, defense-in-depth: the admin page (Phase 6) also guards this route, but the
// action itself must not leak the global pending list to a directly-invoking member caller.
export async function listPendingShareRequestsAction() {
  try {
    const caller = await requireCaller();
    if (caller.role !== "admin") {
      throw new Error("Only an admin can view pending share requests");
    }
    const requests = await ShareRequestService.listPending();
    return { success: true, requests };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error listing pending share requests";
    return { success: false, error: message };
  }
}
