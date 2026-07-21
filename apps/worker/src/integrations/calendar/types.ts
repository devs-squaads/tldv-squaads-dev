export type CalendarProviderName = "google-calendar" | (string & {});

export interface CalendarMeetingEvent {
  provider: CalendarProviderName;
  eventId: string;
  organizerEmail: string | null;
  summary: string | null;
  meetingUrl: string;
  startsAt: Date | null;
  endsAt: Date | null;
  /**
   * users.id of the OAuth-connected calendar owner this event was fetched
   * under. Absent when the event came from the service-account fallback
   * path (no resolvable owner) — see autoJoinService's skip-on-ownerless
   * branch (spec/features/009-meeting-ownership-sharing/plan.md).
   */
  ownerUserId?: string;
  participantEmails?: string[];
}
