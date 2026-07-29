import { describe, expect, it } from "bun:test";
import { resolveBadgeState } from "../../../extension/src/shared/badge-policy";
import type { BadgeState, MeetingStatus } from "../../../extension/src/shared/types";

/**
 * Exhaustive by construction: `Record<MeetingStatus, BadgeState>` fails typecheck
 * if a new status is added to the union without deciding its badge here, so no
 * status can silently fall through untested.
 */
const EXPECTED_BADGE_BY_STATUS: Record<MeetingStatus, BadgeState> = {
  pending: "clear",
  joining: "clear",
  waiting_admission: "clear",
  recording: "recording",
  transcribing: "clear",
  summarizing: "clear",
  completed: "clear",
  admission_timeout: "error",
  rejected: "error",
  error: "error",
  transcription_error: "error",
};

describe("resolveBadgeState", () => {
  it.each(Object.entries(EXPECTED_BADGE_BY_STATUS) as Array<[MeetingStatus, BadgeState]>)(
    "resolves %s to the %s badge",
    (status, expected) => {
      expect(resolveBadgeState(status)).toBe(expected);
    },
  );

  it("clears the badge when there is no status", () => {
    expect(resolveBadgeState(null)).toBe("clear");
  });

  // docs/CONTEXT.md — Meeting Status invariant: widget and popup must always agree.
  // The widget hardcodes "error" for every RETRYABLE_TERMINAL_STATUS, so the popup
  // (which routes the raw status through this policy) must resolve them the same way.
  it.each(["admission_timeout", "rejected", "error"] as const)(
    "agrees with the widget error state for the retryable terminal status %s",
    (status) => {
      expect(resolveBadgeState(status)).toBe("error");
    },
  );
});
