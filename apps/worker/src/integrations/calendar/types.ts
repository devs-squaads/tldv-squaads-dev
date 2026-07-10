export type CalendarProviderName = "google-calendar" | (string & {});

export interface CalendarMeetingEvent {
  provider: CalendarProviderName;
  eventId: string;
  organizerEmail: string | null;
  summary: string | null;
  meetingUrl: string;
  startsAt: Date | null;
  endsAt: Date | null;
}
