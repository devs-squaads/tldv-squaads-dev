interface WorkerRecoveryResult {
  success: boolean;
  error?: string;
}

interface WorkerAutoJoinPollResult extends WorkerRecoveryResult {
  polled?: number;
  enqueued?: number;
}

interface WorkerRefineSummaryResult extends WorkerRecoveryResult {
  summary?: unknown;
}

async function callWorkerRecovery(meetingId: string, action: "reprocess" | "retry"): Promise<WorkerRecoveryResult> {
  const baseUrl = process.env.WORKER_INTERNAL_BASE_URL;
  if (!baseUrl) {
    return { success: false, error: "WORKER_INTERNAL_BASE_URL is not configured" };
  }

  const secret = process.env.API_ROUTE_SECRET;
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/internal/meetings/${meetingId}/${action}`, {
    method: "POST",
    headers: {
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
    },
    cache: "no-store",
  });

  const payload = await response
    .json()
    .catch(() => ({ success: false, error: `Worker ${action} request failed` }));

  return payload as WorkerRecoveryResult;
}

export async function requestMeetingReprocess(meetingId: string): Promise<WorkerRecoveryResult> {
  return callWorkerRecovery(meetingId, "reprocess");
}

export async function requestMeetingRetry(meetingId: string): Promise<WorkerRecoveryResult> {
  return callWorkerRecovery(meetingId, "retry");
}

export async function requestWorkerAutoJoinPoll(): Promise<WorkerAutoJoinPollResult> {
  const baseUrl = process.env.WORKER_INTERNAL_BASE_URL;
  if (!baseUrl) {
    return { success: false, error: "WORKER_INTERNAL_BASE_URL is not configured" };
  }

  const secret = process.env.API_ROUTE_SECRET;
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/internal/auto-join/poll`, {
    method: "POST",
    headers: {
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
    },
    cache: "no-store",
  });

  const payload = await response
    .json()
    .catch(() => ({ success: false, error: "Worker auto-join poll request failed" }));

  return payload as WorkerAutoJoinPollResult;
}

export async function requestMeetingSummaryRefine(
  meetingId: string,
  userPrompt: string,
): Promise<WorkerRefineSummaryResult> {
  const baseUrl = process.env.WORKER_INTERNAL_BASE_URL;
  if (!baseUrl) {
    return { success: false, error: "WORKER_INTERNAL_BASE_URL is not configured" };
  }

  const secret = process.env.API_ROUTE_SECRET;
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/internal/meetings/${meetingId}/refine-summary`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
    },
    body: JSON.stringify({ userPrompt }),
    cache: "no-store",
  });

  const payload = await response
    .json()
    .catch(() => ({ success: false, error: "Worker refine summary request failed" }));

  return payload as WorkerRefineSummaryResult;
}
