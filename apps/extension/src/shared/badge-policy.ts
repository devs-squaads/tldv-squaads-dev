import type { BadgeState, MeetingStatus } from "./types";

/**
 * Statuses that must drive the toolbar badge to the error ("!") state — every
 * failure status, terminal or recoverable. Mirrors the widget, which renders its
 * `error` state (badge "error") for all of admission_timeout/rejected/error.
 */
const BADGE_ERROR_STATUSES: MeetingStatus[] = [
  "error",
  "transcription_error",
  "admission_timeout",
  "rejected",
];

/**
 * Single source of truth for the toolbar badge derived from a meeting status.
 * Both the widget and the popup must consume this so they never drift again
 * (see docs/CONTEXT.md — Meeting Status invariant: widget and popup badge
 * must always agree).
 */
export function resolveBadgeState(status: MeetingStatus | null): BadgeState {
  if (status === "recording") return "recording";
  if (status !== null && BADGE_ERROR_STATUSES.includes(status)) return "error";
  return "clear";
}
