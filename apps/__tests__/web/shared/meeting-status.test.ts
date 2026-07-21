import { describe, expect, it } from "bun:test";
import {
  ACTIVE_PROCESSING_STATUSES,
  canTransitionStatus,
  getMeetingStatusLabel,
  type MeetingStatus,
} from "@meeting-bot/shared/domain/meetingStatus";

const STATUSES: MeetingStatus[] = [
  "pending",
  "joining",
  "waiting_admission",
  "recording",
  "transcribing",
  "summarizing",
  "completed",
  "admission_timeout",
  "rejected",
  "error",
  "transcription_error",
];

describe("getMeetingStatusLabel", () => {
  it("returns Spanish labels for every backend meeting status", () => {
    const labels = STATUSES.map((status) => getMeetingStatusLabel(status));

    expect(labels).toEqual([
      "Pendiente",
      "Uniéndose",
      "Esperando admisión",
      "Grabando",
      "Transcribiendo",
      "Resumiendo",
      "Completada",
      "Tiempo de admisión agotado",
      "Rechazada",
      "Error",
      "Error de transcripción",
    ]);
  });
});

describe("transcription_error — recoverable, not terminal (spec 010 Problem 3)", () => {
  it("can transition to transcribing, summarizing, and completed", () => {
    expect(canTransitionStatus("transcription_error", "transcribing")).toBe(true);
    expect(canTransitionStatus("transcription_error", "summarizing")).toBe(true);
    expect(canTransitionStatus("transcription_error", "completed")).toBe(true);
  });

  it("is not in ACTIVE_PROCESSING_STATUSES (actionable-resolved, not in-progress)", () => {
    expect(ACTIVE_PROCESSING_STATUSES).not.toContain("transcription_error");
  });
});
