import { DEFAULT_SETTINGS } from "../shared/constants";
import { getSettings, saveSettings } from "../shared/storage";
import type { RuntimeMessage, RuntimeResponse } from "../shared/types";
import { detectMeetingProvider, normalizeMeetingUrl } from "../shared/meeting-url";
import { getConnectableSiteContext } from "../shared/origin";
import { checkStatus, connectExtension, inviteBot, pollMeeting } from "./api-client";
import { logError, logInfo } from "../shared/logger";

function isMeetingUrl(url?: string): boolean {
  if (!url) return false;

  const provider = detectMeetingProvider(url);
  if (!provider) return false;

  return Boolean(normalizeMeetingUrl(url, provider));
}

async function clearBadgeIfNoMeetingTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  const hasMeetingTab = tabs.some((tab) => isMeetingUrl(tab.url));

  if (!hasMeetingTab) {
    setBadge("clear");
  }
}

function setBadge(state: "recording" | "error" | "clear") {
  if (state === "recording") {
    chrome.action.setBadgeText({ text: "REC" });
    chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
    return;
  }

  if (state === "error") {
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#f59e0b" });
    return;
  }

  chrome.action.setBadgeText({ text: "" });
}

async function handleMessage(message: RuntimeMessage): Promise<RuntimeResponse> {
  logInfo("runtime message", { type: message.type });
  switch (message.type) {
    case "GET_SETTINGS":
      return { ok: true, data: await getSettings() };

    case "SAVE_SETTINGS": {
      const merged = {
        ...DEFAULT_SETTINGS,
        ...message.settings,
      };
      await saveSettings(merged);
      return { ok: true };
    }

    case "CONNECT_EXTENSION": {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const manualBaseUrl = message.apiBaseUrl?.trim();
      const connectContext = getConnectableSiteContext(tab?.url);
      const apiBaseUrl = manualBaseUrl || connectContext.origin;

      if (!manualBaseUrl && !connectContext.eligible) {
        return { ok: false, error: connectContext.reason };
      }

      if (!apiBaseUrl) {
        return { ok: false, error: "Open the Squaads dashboard tab before connecting the extension." };
      }

      const connection = await connectExtension(apiBaseUrl, message.linkToken);
      const current = await getSettings();
      await saveSettings({
        ...current,
        apiBaseUrl: connection.apiBaseUrl,
        connectionToken: "",
        extensionAccessToken: connection.extensionAccessToken,
        extensionAccessTokenExpiresAt: connection.expiresAt,
        linkedAccountEmail: connection.linkedAccountEmail,
        connectedAt: new Date().toISOString(),
      });

      return { ok: true, data: connection };
    }

    case "CHECK_STATUS":
      return { ok: true, data: await checkStatus(message.meetingUrl, message.provider) };

    case "INVITE_BOT": {
      const settings = await getSettings();
      const botName = message.botName || settings.defaultBotName || DEFAULT_SETTINGS.defaultBotName;
      const duration =
        message.duration || settings.defaultDurationMinutes || DEFAULT_SETTINGS.defaultDurationMinutes;
      return {
        ok: true,
        data: await inviteBot(message.meetingUrl, message.provider, botName, duration),
      };
    }

    case "POLL_MEETING":
      return { ok: true, data: await pollMeeting(message.meetingId) };

    case "SET_BADGE":
      setBadge(message.state);
      return { ok: true };

    default:
      return { ok: false, error: "Unknown runtime message." };
  }
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender: unknown, sendResponse) => {
  handleMessage(message)
    .then((res) => sendResponse(res))
    .catch((error) => {
      logError("runtime message failed", error);
      const text = error instanceof Error ? error.message : "Unknown extension error.";
      sendResponse({ ok: false, error: text } satisfies RuntimeResponse);
    });
  return true;
});

chrome.tabs.onRemoved.addListener(() => {
  void clearBadgeIfNoMeetingTabs();
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (!changeInfo.url && changeInfo.status !== "complete") return;
  if (isMeetingUrl(tab.url)) return;
  void clearBadgeIfNoMeetingTabs();
});
