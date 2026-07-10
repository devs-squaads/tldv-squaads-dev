import { describe, expect, it } from "bun:test";
import { getMeetingStatusLabel, type MeetingStatus } from "@meeting-bot/shared/domain/meetingStatus";

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
    ]);
  });
});
