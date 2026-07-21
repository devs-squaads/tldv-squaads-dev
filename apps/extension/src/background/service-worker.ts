import {
  DEFAULT_SETTINGS,
  FALLBACK_ALARM_NAME,
  FALLBACK_ALARM_PERIOD_MIN,
  HANDSHAKE_TIMEOUT_MS,
} from "../shared/constants";
import { getSettings, saveSettings } from "../shared/storage";
import type { MeetingStatus, PortMessage, RuntimeMessage, RuntimeResponse } from "../shared/types";
import { detectMeetingProvider, normalizeMeetingUrl } from "../shared/meeting-url";
import { getConnectableSiteContext } from "../shared/origin";
import { checkStatus, connectExtension, inviteBot, pollMeeting } from "./api-client";
import { logError, logInfo } from "../shared/logger";
import {
  initialState,
  transition,
  type PortId,
  type SyncEffect,
  type SyncState,
} from "../shared/status-sync";

// ---------------------------------------------------------------------------
// Helpers (existing)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Stateless sendMessage handlers (INVITE_BOT, CHECK_STATUS, etc.)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Single Poller — Port subscription manager
// ---------------------------------------------------------------------------

/** Port channel name used by widget and popup to open a subscription Port. */
const STATUS_PORT_NAME = "squaads-status";

/** Minimal Chrome runtime.Port shape (the project does not use @types/chrome). */
interface ChromePort {
  name: string;
  onMessage: { addListener: (cb: (msg: PortMessage) => void) => void };
  onDisconnect: { addListener: (cb: () => void) => void };
  postMessage: (msg: PortMessage) => void;
  disconnect: () => void;
}

/** Pure state machine state (warm cache — backend is the source of truth). */
let syncState: SyncState = initialState();

/** portId -> Chrome Port object (for broadcast / disconnect effects). */
const ports = new Map<PortId, ChromePort>();

/** portId -> meetingId (to route onDisconnect to the right meeting). */
const portMeeting = new Map<PortId, string>();

/** meetingId -> setTimeout handle for the adaptive poll loop. */
const loopTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** portId -> handshake timeout handle (2s zombie guard). */
const handshakeTimers = new Map<PortId, ReturnType<typeof setTimeout>>();

let portSeq = 0;

chrome.runtime.onConnect.addListener((port: ChromePort) => {
  if (port.name !== STATUS_PORT_NAME) return;

  const portId: PortId = `port-${++portSeq}`;
  ports.set(portId, port);

  // Handshake timeout — disconnect zombie Ports that never send SUBSCRIBE.
  const handshakeTimer = setTimeout(() => {
    handshakeTimers.delete(portId);
    const result = transition(syncState, { type: "HANDSHAKE_TIMEOUT", portId });
    syncState = result.state;
    executeEffects(result.effects);
  }, HANDSHAKE_TIMEOUT_MS);
  handshakeTimers.set(portId, handshakeTimer);

  port.onMessage.addListener((msg: PortMessage) => {
    // HELLO clears the handshake timeout immediately — the port is alive but
    // not yet subscribed to a meeting. No transition, no effects.
    if (msg.type === "HELLO") {
      const ht = handshakeTimers.get(portId);
      if (ht) {
        clearTimeout(ht);
        handshakeTimers.delete(portId);
      }
      return;
    }

    if (msg.type !== "SUBSCRIBE") return;

    // Clear handshake timeout — the port is alive.
    const ht = handshakeTimers.get(portId);
    if (ht) {
      clearTimeout(ht);
      handshakeTimers.delete(portId);
    }

    portMeeting.set(portId, msg.meetingId);
    logInfo("SUBSCRIBE", { meetingId: msg.meetingId, portId });

    const result = transition(syncState, { type: "SUBSCRIBE", meetingId: msg.meetingId, portId });
    syncState = result.state;
    executeEffects(result.effects);
  });

  port.onDisconnect.addListener(() => {
    const ht = handshakeTimers.get(portId);
    if (ht) {
      clearTimeout(ht);
      handshakeTimers.delete(portId);
    }

    if (!ports.has(portId)) return; // already cleaned up (e.g. by disconnectPorts)
    ports.delete(portId);

    const meetingId = portMeeting.get(portId);
    portMeeting.delete(portId);

    if (meetingId) {
      const result = transition(syncState, { type: "DISCONNECT", meetingId, portId });
      syncState = result.state;
      executeEffects(result.effects);
    }
  });
});

// ---------------------------------------------------------------------------
// Effect execution — the SW is a thin layer over the pure state machine
// ---------------------------------------------------------------------------

function executeEffects(effects: SyncEffect[]): void {
  for (const effect of effects) {
    try {
      executeEffect(effect);
    } catch (error) {
      logError("effect failed", { effect, error });
    }
  }
}

function executeEffect(effect: SyncEffect): void {
  switch (effect.type) {
    case "startLoop":
      // The loop starts when fetchSnapshot triggers POLL_TICK -> fetchMeeting.
      // No timer to create here — scheduleNextTick is called after each fetch.
      logInfo("startLoop", { meetingId: effect.meetingId, interval: effect.interval });
      break;

    case "stopLoop":
      stopLoop(effect.meetingId);
      break;

    case "fetchSnapshot":
      void fetchSnapshot(effect.meetingId, effect.portId);
      break;

    case "fetchMeeting":
      void fetchAndProcess(effect.meetingId);
      break;

    case "broadcast":
      broadcast(effect.meetingId, effect.status);
      break;

    case "disconnectPorts":
      disconnectPorts(effect.meetingId);
      break;

    case "disconnectPort":
      disconnectPort(effect.portId);
      break;
  }
}

function stopLoop(meetingId: string): void {
  const timer = loopTimers.get(meetingId);
  if (timer) {
    clearTimeout(timer);
    loopTimers.delete(meetingId);
  }
}

function scheduleNextTick(meetingId: string, interval: number): void {
  stopLoop(meetingId);
  const timer = setTimeout(() => {
    const result = transition(syncState, { type: "POLL_TICK", meetingId });
    syncState = result.state;
    executeEffects(result.effects);
  }, interval);
  loopTimers.set(meetingId, timer);
}

async function fetchSnapshot(meetingId: string, portId: PortId): Promise<void> {
  const meeting = syncState.meetings[meetingId];

  // Cache warm — send the cached snapshot to the subscriber immediately.
  if (meeting?.lastStatus) {
    sendToPort(portId, meetingId, meeting.lastStatus);
    return;
  }

  // Cache cold but a fetch is already in flight — the broadcast will reach
  // this port when the in-flight request resolves.
  if (meeting?.inFlight) {
    return;
  }

  // Cache cold and no fetch in flight — trigger a tick to start the fetch.
  const result = transition(syncState, { type: "POLL_TICK", meetingId });
  syncState = result.state;
  executeEffects(result.effects);
}

async function fetchAndProcess(meetingId: string): Promise<void> {
  try {
    const record = await pollMeeting(meetingId);
    const result = transition(syncState, {
      type: "POLL_RESPONSE",
      meetingId,
      status: record.status,
    });
    syncState = result.state;
    executeEffects(result.effects);
  } catch (error) {
    logError("poll failed", error);
    const result = transition(syncState, { type: "POLL_ERROR", meetingId });
    syncState = result.state;
    executeEffects(result.effects);
  }

  // Relaunch immediately on resolution — schedule the next tick at the
  // adaptive interval (don't wait for a setInterval that may have drifted).
  const loop = syncState.meetings[meetingId];
  if (loop) {
    scheduleNextTick(meetingId, loop.interval);
  }
}

function broadcast(meetingId: string, status: MeetingStatus): void {
  for (const [pid, mid] of portMeeting) {
    if (mid === meetingId) {
      sendToPort(pid, meetingId, status);
    }
  }
}

function sendToPort(portId: PortId, meetingId: string, status: MeetingStatus): void {
  const port = ports.get(portId);
  if (!port) return;
  try {
    port.postMessage({ type: "MEETING_UPDATE", meetingId, status } satisfies PortMessage);
  } catch (error) {
    // Stale/disconnected port — purge from maps so future broadcasts skip it.
    logError("sendToPort failed", { portId, error });
    ports.delete(portId);
    portMeeting.delete(portId);
  }
}

function disconnectPorts(meetingId: string): void {
  const toDisconnect: PortId[] = [];
  for (const [pid, mid] of portMeeting) {
    if (mid === meetingId) toDisconnect.push(pid);
  }
  for (const pid of toDisconnect) {
    // Purge maps before disconnecting — Chrome's onDisconnect fires on the
    // other end, not here, so we must clean up ourselves. Capture the port
    // first so we can still disconnect it after deleting from the map.
    const port = ports.get(pid);
    ports.delete(pid);
    portMeeting.delete(pid);
    port?.disconnect();
  }
}

function disconnectPort(portId: PortId): void {
  const port = ports.get(portId);
  ports.delete(portId);
  portMeeting.delete(portId);
  port?.disconnect();
}

// ---------------------------------------------------------------------------
// chrome.alarms — degraded fallback (NOT the tick base; minimum 30s in Chrome 120+)
// ---------------------------------------------------------------------------

if (typeof chrome.alarms !== "undefined") {
  chrome.alarms.create(FALLBACK_ALARM_NAME, { periodInMinutes: FALLBACK_ALARM_PERIOD_MIN });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== FALLBACK_ALARM_NAME) return;

    // Only run the fallback when no Ports are active (no keepalive).
    // When Ports are active, the setTimeout loop handles polling at 2s/5s.
    if (ports.size > 0) return;

    // Wake-up safety net: keep meeting statuses warm for re-connecting consumers.
    for (const meetingId of Object.keys(syncState.meetings)) {
      const meeting = syncState.meetings[meetingId];
      if (!meeting.inFlight) {
        void fetchAndProcess(meetingId);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Tab listeners (existing)
// ---------------------------------------------------------------------------

chrome.tabs.onRemoved.addListener(() => {
  void clearBadgeIfNoMeetingTabs();
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (!changeInfo.url && changeInfo.status !== "complete") return;
  if (isMeetingUrl(tab.url)) return;
  void clearBadgeIfNoMeetingTabs();
});
