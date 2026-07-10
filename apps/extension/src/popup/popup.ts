import { ACTIVE_STATUSES, DEFAULT_SETTINGS, STATUS_LABELS } from "../shared/constants";
import { detectMeetingProvider, normalizeMeetingUrl } from "../shared/meeting-url";
import { logInfo, logWarn } from "../shared/logger";
import { getConnectableSiteContext, normalizeOrigin } from "../shared/origin";
import type {
  ActiveMeetingEntry,
  ExtensionConnectionResult,
  ExtensionSettings,
  InviteResponse,
  MeetingProvider,
  MeetingRecord,
  RuntimeMessage,
  RuntimeResponse,
  StatusResponse,
} from "../shared/types";

type ConnectionUiState =
  | "not-connected"
  | "ready"
  | "connecting"
  | "connected"
  | "session-expired"
  | "token-expired"
  | "wrong-site"
  | "unsupported-site"
  | "connect-error";

interface ParsedLinkTokenPreview {
  email: string;
  baseUrl: string;
  expiresAt: string;
  expired: boolean;
}

const connectionToken = document.getElementById("connection-token") as HTMLInputElement;
const botName = document.getElementById("bot-name") as HTMLInputElement;
const duration = document.getElementById("duration") as HTMLInputElement;
const connectButton = document.getElementById("connect-extension") as HTMLButtonElement;
const showOverviewButton = document.getElementById("show-overview") as HTMLButtonElement;
const showSettingsButton = document.getElementById("show-settings") as HTMLButtonElement;
const overviewPanel = document.getElementById("overview-panel") as HTMLElement;
const settingsPanel = document.getElementById("settings-panel") as HTMLElement;
const saveButton = document.getElementById("save-settings") as HTMLButtonElement;
const inviteButton = document.getElementById("invite-now") as HTMLButtonElement;
const restoreWidgetButton = document.getElementById("restore-widget") as HTMLButtonElement;
const actions = document.getElementById("meeting-actions") as HTMLDivElement;
const refreshButton = document.getElementById("refresh-status") as HTMLButtonElement;
const feedback = document.getElementById("feedback") as HTMLParagraphElement;
const meetingStatus = document.getElementById("meeting-status") as HTMLParagraphElement;
const meetingMeta = document.getElementById("meeting-meta") as HTMLParagraphElement;
const runtimeStatus = document.getElementById("meeting-runtime-status") as HTMLParagraphElement;
const connectionStatusCard = document.getElementById("connection-status-card") as HTMLDivElement;
const connectionStatusTitle = document.getElementById("connection-status-title") as HTMLParagraphElement;
const connectionStatusCopy = document.getElementById("connection-status-copy") as HTMLParagraphElement;
const connectionSiteCopy = document.getElementById("connection-site-copy") as HTMLParagraphElement;

let currentMeetingUrl: string | null = null;
let currentProvider: MeetingProvider | null = null;
let currentMeetingId: string | null = null;
let currentTabId: number | null = null;
let currentConnectOrigin = "";
let currentConnectReason = "Open the Squaads dashboard tab before connecting.";
let currentConnectEligible = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let currentPolledMeetingId: string | null = null;
let pollRequestInFlight = false;
let cachedSettings: ExtensionSettings = { ...DEFAULT_SETTINGS };
let currentTokenPreview: ParsedLinkTokenPreview | null = null;
let transientConnectionState: ConnectionUiState | null = null;
let transientConnectionDetail = "";

function send(message: RuntimeMessage): Promise<RuntimeResponse> {
  return chrome.runtime.sendMessage(message);
}

function isExpired(isoTimestamp: string): boolean {
  if (!isoTimestamp) return false;
  const parsed = Date.parse(isoTimestamp);
  if (Number.isNaN(parsed)) return false;
  return parsed <= Date.now();
}

function decodeBase64UrlSegment(segment: string): string {
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function parseLinkTokenPreview(token: string): ParsedLinkTokenPreview | null {
  const trimmed = token.trim();
  if (!trimmed) return null;

  const segments = trimmed.split(".");
  const payloadSegment = segments[0];
  if (!payloadSegment) return null;

  try {
    const payload = JSON.parse(decodeBase64UrlSegment(payloadSegment)) as {
      type?: string;
      email?: string;
      baseUrl?: string;
      exp?: number;
    };

    if (payload.type !== "extension_link" || !payload.baseUrl || !payload.email || !payload.exp) {
      return null;
    }

    const expiresAt = new Date(payload.exp * 1000).toISOString();
    return {
      email: payload.email,
      baseUrl: normalizeOrigin(payload.baseUrl),
      expiresAt,
      expired: payload.exp * 1000 <= Date.now(),
    };
  } catch {
    return null;
  }
}

function clearTransientConnectionState() {
  if (transientConnectionState === "connecting") return;
  transientConnectionState = null;
  transientConnectionDetail = "";
}

function setTransientConnectionState(state: ConnectionUiState | null, detail = "") {
  transientConnectionState = state;
  transientConnectionDetail = detail;
}

function setInviteAvailability(enabled: boolean) {
  inviteButton.disabled = !enabled;
}

function setInviteVisibility(visible: boolean) {
  inviteButton.hidden = !visible;
  actions.classList.toggle("actions--single", !visible);
}

function setRestoreWidgetVisibility(visible: boolean) {
  restoreWidgetButton.hidden = !visible;
}

function syncBadge(state: "recording" | "error" | "clear") {
  void send({ type: "SET_BADGE", state });
}

function setActiveView(view: "overview" | "settings") {
  const showOverview = view === "overview";
  overviewPanel.hidden = !showOverview;
  settingsPanel.hidden = showOverview;
  showOverviewButton.classList.toggle("view-toggle__button--active", showOverview);
  showSettingsButton.classList.toggle("view-toggle__button--active", !showOverview);
  showOverviewButton.setAttribute("aria-selected", String(showOverview));
  showSettingsButton.setAttribute("aria-selected", String(!showOverview));
}

function getTargetOrigin(): string {
  return currentConnectOrigin;
}

function getSecureSessionState(settings: ExtensionSettings): "valid" | "expired" | "none" {
  if (!settings.extensionAccessToken || !settings.linkedAccountEmail) {
    return "none";
  }

  return isExpired(settings.extensionAccessTokenExpiresAt) ? "expired" : "valid";
}

function renderConnectionStatus() {
  const secureSessionState = getSecureSessionState(cachedSettings);
  const targetOrigin = currentConnectOrigin;
  let state: ConnectionUiState = "not-connected";
  let title = "Not connected yet";
  let copy = "Paste a temporary connection token from the Squaads dashboard to connect this extension securely.";

  if (transientConnectionState) {
    state = transientConnectionState;
    title = transientConnectionState === "connecting" ? "Connecting to current site" : "Connection requires attention";
    copy = transientConnectionDetail || copy;
  } else if (secureSessionState === "valid") {
    state = "connected";
    title = `Connected as ${cachedSettings.linkedAccountEmail}`;
    copy = cachedSettings.extensionAccessTokenExpiresAt
      ? `Secure extension session active until ${new Date(cachedSettings.extensionAccessTokenExpiresAt).toLocaleString()}. Paste a new token only if you want to reconnect.`
      : "Secure extension session active.";
  } else if (secureSessionState === "expired") {
    state = "session-expired";
    title = "Session expired";
    copy = "Your secure extension session expired. Go back to the Squaads dashboard, generate a new token, and reconnect from this site.";
  } else if (currentTokenPreview?.expired) {
    state = "token-expired";
    title = "Connection token expired";
    copy = "This temporary token expired before connection. Generate a fresh token from the dashboard and paste it again.";
  } else if (connectionToken.value.trim() && !currentTokenPreview) {
    state = "connect-error";
    title = "Malformed connection token";
    copy = "This token could not be decoded by the extension. Generate a fresh token from the Squaads dashboard and paste it again.";
  } else if (currentTokenPreview) {
    if (!targetOrigin) {
      state = "unsupported-site";
      title = "Open the correct dashboard tab";
      copy = currentConnectReason;
    } else if (currentTokenPreview.baseUrl !== targetOrigin) {
      state = "wrong-site";
      title = "Wrong site for this token";
      copy = `This token was generated for ${currentTokenPreview.baseUrl}. Open that same Squaads site before connecting.`;
    } else {
      state = "ready";
      title = "Ready to connect";
      copy = `Token ready for ${currentTokenPreview.email}. Click Connect to Current Site to bind this extension to ${targetOrigin}.`;
    }
  }

  connectionStatusCard.className = `connection-status connection-status--${state}`;
  connectionStatusTitle.textContent = title;
  connectionStatusCopy.textContent = copy;
  connectionSiteCopy.textContent = currentConnectReason;

  const canAttemptConnect = (state === "ready" || state === "connected") && Boolean(currentTokenPreview);
  connectButton.disabled = !canAttemptConnect || transientConnectionState === "connecting";
  connectButton.textContent = transientConnectionState === "connecting" ? "Connecting..." : "Connect to Current Site";
}

function formatMeetingMeta(provider: MeetingProvider, meetingUrl: string) {
  const compactUrl = meetingUrl
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/^meet\.google\.com\//, "Google Meet · ")
    .replace(/^teams\.microsoft\.com\//, "Microsoft Teams · ")
    .replace(/^([^.]+\.)?zoom\.(us|com)\//, "Zoom · ");

  return `Live sync on ${provider.replace("-", " ")} · ${compactUrl}`;
}

async function sendToActiveTab(message: RuntimeMessage): Promise<RuntimeResponse | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (typeof tab?.id !== "number") return null;

  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    return null;
  }
}

async function refreshWidgetState() {
  const response = await sendToActiveTab({ type: "GET_WIDGET_STATE" });
  if (!response?.ok || !("data" in response)) {
    setRestoreWidgetVisibility(false);
    return;
  }

  const state = response.data as { collapsed: boolean };
  setRestoreWidgetVisibility(state.collapsed);
}

function resetMeetingControls() {
  stopPolling();
  setInviteVisibility(false);
  setInviteAvailability(false);
  setRestoreWidgetVisibility(false);
  syncBadge("clear");
}

function applyMeetingEntry(entry: ActiveMeetingEntry | null) {
  if (!entry) {
    currentMeetingId = null;
    runtimeStatus.textContent = "Status: idle";
    stopPolling();
    setInviteVisibility(true);
    setInviteAvailability(true);
    syncBadge("clear");
    void refreshWidgetState();
    return;
  }

  currentMeetingId = entry.meetingId;
  runtimeStatus.textContent = `Status: ${STATUS_LABELS[entry.status]}`;

  if (entry.status === "recording") {
    syncBadge("recording");
  } else if (entry.status === "error") {
    syncBadge("error");
  } else {
    syncBadge("clear");
  }

  if (ACTIVE_STATUSES.includes(entry.status)) {
    setInviteVisibility(false);
    setInviteAvailability(false);
    startPolling();
    void refreshWidgetState();
    return;
  }

  stopPolling();
  setInviteVisibility(true);
  setInviteAvailability(true);
  void refreshWidgetState();
}

function syncTokenPreviewFromInput() {
  currentTokenPreview = parseLinkTokenPreview(connectionToken.value);
  clearTransientConnectionState();
  renderConnectionStatus();
}

async function loadSettings() {
  const response = await send({ type: "GET_SETTINGS" });
  if (!response.ok) return;
  const settings = (response as { ok: true; data: ExtensionSettings }).data;
  cachedSettings = settings;
  connectionToken.value = settings.connectionToken;
  botName.value = settings.defaultBotName;
  duration.value = String(settings.defaultDurationMinutes);
  syncTokenPreviewFromInput();
}

async function saveSettings() {
  const settings: ExtensionSettings = {
    ...cachedSettings,
    connectionToken: connectionToken.value.trim(),
    defaultBotName: botName.value.trim() || DEFAULT_SETTINGS.defaultBotName,
    defaultDurationMinutes: Number(duration.value) || DEFAULT_SETTINGS.defaultDurationMinutes,
  };

  const response = await send({ type: "SAVE_SETTINGS", settings });
  feedback.textContent = response.ok ? "Settings saved." : (response as { ok: false; error: string }).error;
  if (response.ok) {
    cachedSettings = settings;
    setActiveView("overview");
    syncTokenPreviewFromInput();
  }
  await refreshRuntimeStatus();
}

async function connectFromPopup() {
  const trimmedToken = connectionToken.value.trim();
  const parsedToken = parseLinkTokenPreview(trimmedToken);

  if (!trimmedToken) {
    feedback.textContent = "Paste the connection token from the Squaads web app first.";
    setTransientConnectionState("connect-error", "Paste the temporary token from the dashboard before connecting.");
    renderConnectionStatus();
    return;
  }

  if (!parsedToken) {
    feedback.textContent = "This connection token is malformed. Generate a new one from the dashboard.";
    setTransientConnectionState("connect-error", "The pasted token is not valid. Generate a fresh one from the Squaads dashboard.");
    renderConnectionStatus();
    return;
  }

  if (parsedToken.expired) {
    feedback.textContent = "This connection token expired. Generate a new one from the dashboard.";
    currentTokenPreview = parsedToken;
    clearTransientConnectionState();
    renderConnectionStatus();
    return;
  }

  const targetOrigin = getTargetOrigin();
  if (!targetOrigin) {
    feedback.textContent = currentConnectReason;
    setTransientConnectionState("unsupported-site", currentConnectReason);
    renderConnectionStatus();
    return;
  }

  if (parsedToken.baseUrl !== targetOrigin) {
    feedback.textContent = `Open ${parsedToken.baseUrl} before connecting this token.`;
    setTransientConnectionState(
      "wrong-site",
      `This token belongs to ${parsedToken.baseUrl}. Open that same Squaads dashboard tab and try again.`,
    );
    renderConnectionStatus();
    return;
  }

  setTransientConnectionState("connecting", `Connecting this extension to ${targetOrigin}...`);
  renderConnectionStatus();
  feedback.textContent = "Connecting extension...";

  const response = await send({
    type: "CONNECT_EXTENSION",
    linkToken: trimmedToken,
  });

  if (!response.ok) {
    const errorText = (response as { ok: false; error: string }).error;
    feedback.textContent = errorText;
    setTransientConnectionState("connect-error", errorText);
    renderConnectionStatus();
    return;
  }

  const data = (response as { ok: true; data: ExtensionConnectionResult }).data;
  cachedSettings = {
    ...cachedSettings,
    apiBaseUrl: data.apiBaseUrl,
    connectionToken: "",
    extensionAccessToken: data.extensionAccessToken,
    extensionAccessTokenExpiresAt: data.expiresAt,
    linkedAccountEmail: data.linkedAccountEmail,
    connectedAt: new Date().toISOString(),
  };

  connectionToken.value = "";
  currentTokenPreview = null;
  setTransientConnectionState(null);
  renderConnectionStatus();
  feedback.textContent = `Extension connected successfully for ${data.linkedAccountEmail}.`;
}

async function inspectCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = typeof tab?.id === "number" ? tab.id : null;
  const url = tab?.url || "";
  const connectContext = getConnectableSiteContext(url);
  currentConnectOrigin = connectContext.origin;
  currentConnectReason = connectContext.reason;
  currentConnectEligible = connectContext.eligible;
  clearTransientConnectionState();
  renderConnectionStatus();

  const provider = detectMeetingProvider(url);

  if (!provider) {
    currentMeetingUrl = null;
    currentProvider = null;
    currentMeetingId = null;
    currentTabId = null;
    resetMeetingControls();
    refreshButton.disabled = true;
    meetingStatus.textContent = "Current tab is not Meet, Teams, or Zoom.";
    meetingMeta.textContent = "Open a supported meeting to enable runtime controls.";
    runtimeStatus.textContent = currentConnectEligible ? `Connection site ready: ${currentConnectOrigin}` : "";
    return;
  }

  const normalized = normalizeMeetingUrl(url, provider);
  if (!normalized) {
    currentMeetingUrl = null;
    currentProvider = null;
    currentMeetingId = null;
    currentTabId = null;
    resetMeetingControls();
    refreshButton.disabled = true;
    meetingStatus.textContent = "Could not normalize meeting URL for this tab.";
    meetingMeta.textContent = "This tab was detected, but the meeting URL could not be normalized safely.";
    runtimeStatus.textContent = "";
    return;
  }

  currentProvider = provider;
  currentMeetingUrl = normalized;
  setInviteVisibility(true);
  setInviteAvailability(true);
  setRestoreWidgetVisibility(false);
  refreshButton.disabled = false;
  meetingStatus.textContent = `Detected ${provider} meeting.`;
  meetingMeta.textContent = formatMeetingMeta(provider, normalized);
  logInfo("popup detected active meeting", { provider, currentMeetingUrl });
  await refreshRuntimeStatus();
}

async function inviteFromPopup() {
  if (!currentMeetingUrl || !currentProvider) return;
  feedback.textContent = "Inviting bot...";
  setInviteVisibility(false);
  inviteButton.disabled = true;

  const response = await send({
    type: "INVITE_BOT",
    meetingUrl: currentMeetingUrl,
    provider: currentProvider,
  });

  if (!response.ok) {
    const error = (response as { ok: false; error: string }).error;
    logWarn("popup invite failed", { error });
    feedback.textContent = error;
    setInviteVisibility(true);
    inviteButton.disabled = false;
    return;
  }

  const data = (response as { ok: true; data: InviteResponse }).data;
  logInfo("popup invite queued", data);
  feedback.textContent = `Bot queued successfully for ${data.provider}.`;
  currentMeetingId = data.meetingId;
  runtimeStatus.textContent = `Status: ${STATUS_LABELS.pending}`;
  startPolling();
  setInviteAvailability(false);
  await refreshWidgetState();
}

async function restoreWidgetFromPopup() {
  const response = await sendToActiveTab({ type: "RESTORE_WIDGET" });
  if (!response?.ok) {
    feedback.textContent = "Could not restore floating widget in this tab.";
    return;
  }

  feedback.textContent = "Floating widget restored.";
  await refreshWidgetState();
}

async function refreshRuntimeStatus() {
  if (!currentMeetingUrl || !currentProvider) return;
  const response = await send({
    type: "CHECK_STATUS",
    meetingUrl: currentMeetingUrl,
    provider: currentProvider,
  });

  if (!response.ok) {
    const error = (response as { ok: false; error: string }).error;
    stopPolling();
    currentMeetingId = null;
    syncBadge("clear");
    runtimeStatus.textContent = error;
    setInviteVisibility(true);
    setInviteAvailability(true);
    return;
  }

  const data = (response as { ok: true; data: StatusResponse }).data;
  if (!data.active || !data.meeting) {
    applyMeetingEntry(null);
    return;
  }

  applyMeetingEntry({
    meetingId: data.meeting.id,
    meetingUrl: data.normalizedUrl || currentMeetingUrl,
    provider: currentProvider,
    status: data.meeting.status,
  });
}

function startPolling() {
  if (!currentMeetingId) return;
  if (pollTimer && currentPolledMeetingId === currentMeetingId) return;
  stopPolling();
  currentPolledMeetingId = currentMeetingId;
  pollTimer = setInterval(async () => {
    if (!currentMeetingId || pollRequestInFlight) return;
    pollRequestInFlight = true;
    let response: RuntimeResponse;

    try {
      response = await send({ type: "POLL_MEETING", meetingId: currentMeetingId });
    } finally {
      pollRequestInFlight = false;
    }

    if (!response.ok) {
      stopPolling();
      await refreshRuntimeStatus();
      return;
    }

    const meeting = (response as { ok: true; data: MeetingRecord }).data;
    if (!currentMeetingUrl || !currentProvider) return;
    applyMeetingEntry({
      meetingId: meeting.id,
      meetingUrl: meeting.url || currentMeetingUrl,
      provider: currentProvider,
      status: meeting.status,
    });
  }, 5000);
}

function stopPolling() {
  currentPolledMeetingId = null;
  pollRequestInFlight = false;
  if (!pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage) => {
  if (message.type !== "MEETING_UPDATE") return;
  if (!currentMeetingUrl || message.meetingUrl !== currentMeetingUrl) return;
  applyMeetingEntry(message.entry);
});

chrome.tabs.onActivated.addListener(() => {
  void inspectCurrentTab();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (currentTabId !== null && tabId !== currentTabId) return;
  if (!(changeInfo.url || changeInfo.status === "complete")) return;
  void inspectCurrentTab();
});

showOverviewButton.addEventListener("click", () => setActiveView("overview"));
showSettingsButton.addEventListener("click", () => setActiveView("settings"));
saveButton.addEventListener("click", () => void saveSettings());
connectButton.addEventListener("click", () => void connectFromPopup());
inviteButton.addEventListener("click", () => void inviteFromPopup());
restoreWidgetButton.addEventListener("click", () => void restoreWidgetFromPopup());
refreshButton.addEventListener("click", () => void refreshRuntimeStatus());
connectionToken.addEventListener("input", () => syncTokenPreviewFromInput());

document.addEventListener("DOMContentLoaded", () => {
  setActiveView("overview");
  setInviteVisibility(false);
  setRestoreWidgetVisibility(false);
  renderConnectionStatus();
  void loadSettings();
  void inspectCurrentTab();
});
