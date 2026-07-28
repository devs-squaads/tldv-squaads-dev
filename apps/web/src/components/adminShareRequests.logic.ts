/**
 * Pure display-name logic for `AdminShareRequestsView` (013 admin feedback: pending-request
 * cards showed "Reunión meeting-<uuid>" instead of a real name). Kept separate from JSX per
 * AGENTS.md's TDD convention (`*.logic.ts`, mirrored under `apps/__tests__/web/components/`).
 */

export interface MeetingDisplayInput {
  name: string | null;
  botName?: string | null;
  url: string;
  createdAt: Date;
}

/**
 * Resolves a human-readable label for a meeting: botName (what MeetingDetailsView's header
 * already prefers) → name → url → createdAt as a last-resort fallback. Never returns the raw
 * meeting id — an admin deciding whether to grant access needs something they can recognize.
 * `meeting` is null when the referenced meeting row itself no longer exists.
 */
export function resolveMeetingDisplayName(meeting: MeetingDisplayInput | null): string {
  if (!meeting) return "Reunión eliminada";
  if (meeting.botName) return meeting.botName;
  if (meeting.name) return meeting.name;
  if (meeting.url) return meeting.url;
  return meeting.createdAt.toISOString().slice(0, 10);
}
