import type { CalendarMeetingEvent } from "./types";

export interface CalendarProvider {
  listMeetingEvents(params: {
    organizerEmails: string[];
    timeMin: Date;
    timeMax: Date;
  }): Promise<CalendarMeetingEvent[]>;
}
