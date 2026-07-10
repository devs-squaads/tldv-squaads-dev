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
};

export const ACTIVE_PROCESSING_STATUSES: ReadonlyArray<MeetingStatus> = [
  "pending",
  "joining",
  "waiting_admission",
  "recording",
  "transcribing",
  "summarizing",
];

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
};

export function canTransitionStatus(from: MeetingStatus, to: MeetingStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function getMeetingStatusLabel(status: MeetingStatus): string {
  return MEETING_STATUS_LABELS_ES[status];
}
