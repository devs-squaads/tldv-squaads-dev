import { describe, expect, it } from "bun:test";
import {
  ACTIVE_PROCESSING_STATUSES,
  EXTENSION_TRACKABLE_STATUSES,
} from "@meeting-bot/shared/domain/meetingStatus";
import {
  ACTIVE_STATUSES,
  STATUS_COLORS,
  STATUS_LABELS,
  TRACKABLE_STATUSES,
} from "../../../extension/src/shared/constants";

const BACKEND_STATUSES = [
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
] as const;

describe("extension status contract alignment", () => {
  it("matches active statuses with backend", () => {
    expect([...ACTIVE_STATUSES].sort()).toEqual([...ACTIVE_PROCESSING_STATUSES].sort());
  });

  it("matches trackable recovery statuses with backend", () => {
    expect([...TRACKABLE_STATUSES].sort()).toEqual([...EXTENSION_TRACKABLE_STATUSES].sort());
  });

  it("has labels for all backend statuses", () => {
    for (const status of BACKEND_STATUSES) {
      expect(STATUS_LABELS[status]).toBeDefined();
      expect(STATUS_LABELS[status].length).toBeGreaterThan(0);
    }
  });

  it("has colors for all backend statuses", () => {
    const hex = /^#[0-9a-fA-F]{6}$/;
    for (const status of BACKEND_STATUSES) {
      expect(STATUS_COLORS[status]).toMatch(hex);
    }
  });
});
