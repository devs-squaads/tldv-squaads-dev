import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { autoJoinPollAndEnqueue } from "@/services/autoJoinService";
import { refineMeetingSummary, reprocessMeetingTranscription, retryRejectedMeeting } from "@/services/meetingRecoveryService";

function json(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function isAuthorized(req: IncomingMessage): boolean {
  const secret = process.env.API_ROUTE_SECRET;
  if (!secret) {
    console.error("[internal-api] FATAL: API_ROUTE_SECRET is not defined — refusing all requests");
    return false;
  }
  return req.headers.authorization === `Bearer ${secret}`;
}

async function handleRecovery(req: IncomingMessage, res: ServerResponse, meetingId: string, action: "reprocess" | "retry") {
  if (!isAuthorized(req)) {
    json(res, 401, { success: false, error: "Unauthorized" });
    return;
  }

  if (req.method !== "POST") {
    json(res, 405, { success: false, error: "Method not allowed" });
    return;
  }

  const result = action === "reprocess"
    ? await reprocessMeetingTranscription(meetingId)
    : await retryRejectedMeeting(meetingId);

  json(res, result.success ? 200 : 400, result);
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf-8");
  return JSON.parse(raw) as Record<string, unknown>;
}

async function handleRefineSummary(req: IncomingMessage, res: ServerResponse, meetingId: string) {
  if (!isAuthorized(req)) {
    json(res, 401, { success: false, error: "Unauthorized" });
    return;
  }

  if (req.method !== "POST") {
    json(res, 405, { success: false, error: "Method not allowed" });
    return;
  }

  const body = await readJsonBody(req);
  const userPrompt = typeof body.userPrompt === "string" ? body.userPrompt.trim() : "";
  if (!userPrompt) {
    json(res, 400, { success: false, error: "userPrompt is required" });
    return;
  }

  const result = await refineMeetingSummary(meetingId, userPrompt);
  json(res, result.success ? 200 : 400, result);
}

async function handleAutoJoinPoll(req: IncomingMessage, res: ServerResponse) {
  if (!isAuthorized(req)) {
    json(res, 401, { success: false, error: "Unauthorized" });
    return;
  }

  if (req.method !== "POST") {
    json(res, 405, { success: false, error: "Method not allowed" });
    return;
  }

  const result = await autoJoinPollAndEnqueue();
  json(res, 200, {
    success: true,
    polled: result.polled,
    enqueued: result.enqueued,
  });
}

async function requestListener(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || "/", "http://worker.internal");

  if (url.pathname === "/health") {
    if (req.method !== "GET") {
      json(res, 405, { success: false, error: "Method not allowed" });
      return;
    }
    json(res, 200, { status: "ok", role: "worker", uptime: Math.floor(process.uptime()) });
    return;
  }

  if (url.pathname === "/internal/auto-join/poll") {
    await handleAutoJoinPoll(req, res);
    return;
  }

  const refineMatch = url.pathname.match(/^\/internal\/meetings\/([^/]+)\/refine-summary$/);
  if (refineMatch) {
    const [, meetingId] = refineMatch;
    await handleRefineSummary(req, res, meetingId);
    return;
  }

  const match = url.pathname.match(/^\/internal\/meetings\/([^/]+)\/(reprocess|retry)$/);

  if (!match) {
    json(res, 404, { success: false, error: "Not found" });
    return;
  }

  const [, meetingId, action] = match;
  await handleRecovery(req, res, meetingId, action as "reprocess" | "retry");
}

export async function startInternalApiServer(): Promise<{ stop: () => Promise<void> }> {
  const port = Number(process.env.WORKER_INTERNAL_PORT || 4000);
  const server = createServer((req, res) => {
    void requestListener(req, res).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown internal API error";
      console.error("[worker:internal-api] Request failed:", message);
      json(res, 500, { success: false, error: message });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => {
      server.off("error", reject);
      resolve();
    });
  });

  console.log(`[worker:internal-api] Listening on 0.0.0.0:${port}`);

  return {
    stop: async () =>
      new Promise<void>((resolve, reject) => {
        if (!server.listening) {
          resolve();
          return;
        }

        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}
