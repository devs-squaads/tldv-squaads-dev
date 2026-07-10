import { REQUEST_TIMEOUT_MS } from "../shared/constants";
import { getSettings, saveSettings } from "../shared/storage";
import type {
  ExtensionConnectionResult,
  InviteResponse,
  MeetingProvider,
  MeetingRecord,
  StatusResponse,
} from "../shared/types";
import { logError, logInfo } from "../shared/logger";

type AuthMode = "linked-session" | "legacy-token";

function isExpired(isoTimestamp: string): boolean {
  if (!isoTimestamp) return false;
  const parsed = Date.parse(isoTimestamp);
  if (Number.isNaN(parsed)) return false;
  return parsed <= Date.now();
}

function mapApiError(status: number, text: string): string {
  if (status === 401) {
    if (/expired link token/i.test(text)) return "This connection token expired. Go back to the Squaads dashboard and generate a new one.";
    if (/expired extension access token/i.test(text)) return "Your secure extension session expired. Reconnect it from the Squaads dashboard.";
    if (/invalid or expired extension access token/i.test(text)) return "Your secure extension session expired. Reconnect it from the Squaads dashboard.";
    if (/invalid or expired link token/i.test(text)) return "This connection token is invalid or expired. Generate a new one from the dashboard.";
    return "Unauthorized. Verify extension connection or legacy API token.";
  }
  if (status === 403) {
    if (/origin mismatch/i.test(text)) return "Wrong site for this token. Open the same Squaads dashboard tab where you generated it and try again.";
    return "Forbidden by server.";
  }
  if (status === 404) return "Endpoint not found. Verify API base URL.";
  if (status >= 500) return "Server error. Please check backend logs.";
  return `API ${status}: ${text}`;
}

async function resolveTransport(path: string): Promise<{ apiBaseUrl: string; token: string; authMode: AuthMode; path: string }> {
  let settings = await getSettings();
  const apiBaseUrl = settings.apiBaseUrl;

  if (!apiBaseUrl) {
    throw new Error("Extension not configured. Open Configuration and connect it first.");
  }

  if (settings.extensionAccessToken) {
    if (isExpired(settings.extensionAccessTokenExpiresAt)) {
      settings = {
        ...settings,
        connectionToken: "",
        extensionAccessToken: "",
        extensionAccessTokenExpiresAt: "",
        linkedAccountEmail: "",
        connectedAt: "",
      };
      await saveSettings(settings);

      if (!settings.apiToken) {
        throw new Error("Secure extension session expired. Reconnect it from the Squaads dashboard.");
      }
    }
  }

  if (settings.extensionAccessToken) {
    return {
      apiBaseUrl,
      token: settings.extensionAccessToken,
      authMode: "linked-session",
      path: path.replace("/api/", "/api/v1/extension/"),
    };
  }

  if (settings.apiToken) {
    return {
      apiBaseUrl,
      token: settings.apiToken,
      authMode: "legacy-token",
      path,
    };
  }

  throw new Error("Extension not configured. Connect it with a secure token or add a legacy API token.");
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const transport = await resolveTransport(path);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${transport.apiBaseUrl}${transport.path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${transport.token}`,
        ...(init.headers || {}),
      },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new Error(mapApiError(response.status, text));
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Server timeout after 10s. Verify backend is reachable.");
    }
    logError("apiFetch failed", error);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function connectExtension(apiBaseUrl: string, linkToken: string): Promise<ExtensionConnectionResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/api/v1/extension/connect`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ linkToken }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new Error(mapApiError(response.status, text));
    }

    return (await response.json()) as ExtensionConnectionResult;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Server timeout after 10s. Verify backend is reachable.");
    }
    logError("connectExtension failed", error);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkStatus(meetingUrl: string, provider: MeetingProvider): Promise<StatusResponse> {
  logInfo("checkStatus", { provider, meetingUrl });
  return apiFetch<StatusResponse>(
    `/api/meetings/status?url=${encodeURIComponent(meetingUrl)}&provider=${encodeURIComponent(provider)}`
  );
}

export async function inviteBot(
  meetingUrl: string,
  provider: MeetingProvider,
  botName: string,
  duration: number
): Promise<InviteResponse> {
  logInfo("inviteBot", { provider, meetingUrl });
  const payload = await apiFetch<{
    message: string;
    results: Array<{
      url: string;
      provider: MeetingProvider;
      meetingId?: string;
      queued: boolean;
      error?: string;
    }>;
  }>("/api/bot/start", {
    method: "POST",
    body: JSON.stringify({
      meetingUrl,
      provider,
      botName,
      duration,
    }),
  });

  const first = payload.results[0];
  if (!first) throw new Error("Invalid start response.");
  if (!first.queued || !first.meetingId) {
    throw new Error(first.error || "Bot was not queued.");
  }

  return {
    meetingId: first.meetingId,
    queued: first.queued,
    provider: first.provider,
    normalizedUrl: first.url,
  };
}

export async function pollMeeting(meetingId: string): Promise<MeetingRecord> {
  return apiFetch<MeetingRecord>(`/api/meetings/${meetingId}`);
}
