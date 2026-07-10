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

export const ACTIVE_STATUSES: MeetingStatus[] = [
  "pending",
  "joining",
  "waiting_admission",
  "recording",
  "transcribing",
  "summarizing",
];

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
};
