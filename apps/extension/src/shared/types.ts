export type MeetingProvider = "google-meet" | "microsoft-teams" | "zoom";

export type MeetingStatus =
  | "pending"
  | "joining"
  | "waiting_admission"
  | "recording"
  | "transcribing"
  | "summarizing"
  | "completed"
  | "admission_timeout"
  | "rejected"
  | "error";

export interface ExtensionSettings {
  apiBaseUrl: string;
  apiToken: string;
  connectionToken: string;
  extensionAccessToken: string;
  extensionAccessTokenExpiresAt: string;
  linkedAccountEmail: string;
  connectedAt: string;
  defaultBotName: string;
  defaultDurationMinutes: number;
}

export interface ExtensionConnectionResult {
  apiBaseUrl: string;
  linkedAccountEmail: string;
  extensionAccessToken: string;
  expiresAt: string;
}

export interface MeetingRecord {
  id: string;
  url: string;
  status: MeetingStatus;
  botName: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StatusResponse {
  active: boolean;
  normalizedUrl: string;
  meeting: MeetingRecord | null;
}

export interface InviteResponse {
  meetingId: string;
  queued: boolean;
  provider: MeetingProvider;
  normalizedUrl: string;
}

export interface ActiveMeetingEntry {
  meetingId: string;
  meetingUrl: string;
  provider: MeetingProvider;
  status: MeetingStatus;
}

export interface WidgetPosition {
  x: number;
  y: number;
}

export type BadgeState = "recording" | "error" | "clear";

export type RuntimeMessage =
  | { type: "GET_SETTINGS" }
  | { type: "SAVE_SETTINGS"; settings: ExtensionSettings }
  | { type: "CONNECT_EXTENSION"; linkToken: string; apiBaseUrl?: string }
  | { type: "CHECK_STATUS"; meetingUrl: string; provider: MeetingProvider }
  | { type: "INVITE_BOT"; meetingUrl: string; provider: MeetingProvider; botName?: string; duration?: number }
  | { type: "POLL_MEETING"; meetingId: string }
  | { type: "MEETING_UPDATE"; meetingUrl: string; entry: ActiveMeetingEntry | null }
  | { type: "RESTORE_WIDGET" }
  | { type: "GET_WIDGET_STATE" }
  | { type: "SET_BADGE"; state: BadgeState };

export type RuntimeResponse =
  | { ok: true; data: ExtensionSettings }
  | { ok: true; data: ExtensionConnectionResult }
  | { ok: true; data: StatusResponse }
  | { ok: true; data: MeetingRecord }
  | { ok: true; data: InviteResponse }
  | { ok: true; data: { collapsed: boolean } }
  | { ok: true }
  | { ok: false; error: string };
