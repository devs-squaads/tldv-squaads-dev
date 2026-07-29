import type { ExtensionSettings, MeetingStatus } from "./types";

export const DEFAULT_SETTINGS: ExtensionSettings = {
  apiBaseUrl: "",
  apiToken: "",
  connectionToken: "",
  extensionAccessToken: "",
  extensionAccessTokenExpiresAt: "",
  linkedAccountEmail: "",
  connectedAt: "",
  defaultBotName: "Squaads Assistant",
  defaultDurationMinutes: 60,
};

export const POLL_INTERVAL_MS = 5000;
export const REQUEST_TIMEOUT_MS = 10000;

/** Max time (ms) a Port can stay open without sending SUBSCRIBE before disconnect. */
export const HANDSHAKE_TIMEOUT_MS = 2000;

/** Popup mini-poll interval (ms) while searching for an active meeting. */
export const SEARCH_POLL_INTERVAL_MS = 2000;

/** chrome.alarms period in minutes for the degraded fallback (Chrome 120+ minimum is 30s). */
export const FALLBACK_ALARM_PERIOD_MIN = 0.5;

/** Name of the chrome.alarms fallback alarm. */
export const FALLBACK_ALARM_NAME = "squaads-poll-fallback";

export const ACTIVE_STATUSES: MeetingStatus[] = [
  "pending",
  "joining",
  "waiting_admission",
  "recording",
  "transcribing",
  "summarizing",
];

export const TRACKABLE_STATUSES: MeetingStatus[] = [...ACTIVE_STATUSES, "transcription_error"];

export const RETRYABLE_TERMINAL_STATUSES: MeetingStatus[] = ["admission_timeout", "rejected", "error"];

export const STATUS_LABELS: Record<MeetingStatus, string> = {
  pending: "Queued",
  joining: "Joining",
  waiting_admission: "Waiting admission",
  recording: "Recording",
  transcribing: "Transcribing",
  summarizing: "Summarizing",
  completed: "Completed",
  admission_timeout: "Admission timeout",
  rejected: "Rejected",
  error: "Error",
  transcription_error: "Transcription error",
};

export const STATUS_COLORS: Record<MeetingStatus, string> = {
  pending: "#f59e0b",
  joining: "#3b82f6",
  waiting_admission: "#f59e0b",
  recording: "#ef4444",
  transcribing: "#8b5cf6",
  summarizing: "#8b5cf6",
  completed: "#10b981",
  admission_timeout: "#ef4444",
  rejected: "#ef4444",
  error: "#ef4444",
  transcription_error: "#ef4444",
};
