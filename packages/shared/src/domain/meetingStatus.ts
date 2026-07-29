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

const ALLOWED_TRANSITIONS: Record<MeetingStatus, ReadonlyArray<MeetingStatus>> = {
  pending: ["joining", "error"],
  joining: ["waiting_admission", "recording", "admission_timeout", "rejected", "error"],
  waiting_admission: ["recording", "admission_timeout", "rejected", "error"],
  recording: ["transcribing", "completed", "error"],
  transcribing: ["summarizing", "completed", "error"],
  summarizing: ["completed", "error"],
  completed: [],
  admission_timeout: ["pending"],
  rejected: ["pending"],
  error: [],
  // Recoverable, unlike error/rejected: the recording is already saved, only the AI
  // post-processing pass failed, so it can retry from storage without rejoining the meeting.
  transcription_error: ["transcribing", "summarizing", "completed"],
};

export const ACTIVE_PROCESSING_STATUSES: ReadonlyArray<MeetingStatus> = [
  "pending",
  "joining",
  "waiting_admission",
  "recording",
  "transcribing",
  "summarizing",
];

export const EXTENSION_TRACKABLE_STATUSES: ReadonlyArray<MeetingStatus> = [
  ...ACTIVE_PROCESSING_STATUSES,
  "transcription_error",
];

/**
 * Rolling 24h window measured back from the time of each request (not a calendar-day
 * boundary): keeps long recordings and recoverable post-processing visible while
 * preventing a reused meeting URL from binding to an indefinitely stale row.
 */
export const EXTENSION_TRACKABLE_FRESHNESS_MS = 24 * 60 * 60 * 1000;

const MEETING_STATUS_LABELS_ES: Record<MeetingStatus, string> = {
  pending: "Pendiente",
  joining: "Uniéndose",
  waiting_admission: "Esperando admisión",
  recording: "Grabando",
  transcribing: "Transcribiendo",
  summarizing: "Resumiendo",
  completed: "Completada",
  admission_timeout: "Tiempo de admisión agotado",
  rejected: "Rechazada",
  error: "Error",
  transcription_error: "Error de transcripción",
};

export function canTransitionStatus(from: MeetingStatus, to: MeetingStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function getMeetingStatusLabel(status: MeetingStatus): string {
  return MEETING_STATUS_LABELS_ES[status];
}
