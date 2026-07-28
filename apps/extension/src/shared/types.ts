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
  | "error"
  | "transcription_error";

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

/**
 * Messages sent over a long-lived Port (SW <-> widget/popup subscription).
 *
 * The Port is simultaneously the subscription channel, the SW keepalive, and
 * the subscriber counter. `SUBSCRIBE` is the handshake; `MEETING_UPDATE` is
 * the broadcast the SW sends to all subscribers of a meeting.
 */
export type PortMessage =
  | { type: "HELLO" }
  | { type: "SUBSCRIBE"; meetingId: string; provider: MeetingProvider }
  | { type: "MEETING_UPDATE"; meetingId: string; status: MeetingStatus };
