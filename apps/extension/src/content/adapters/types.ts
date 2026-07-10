import type { MeetingProvider } from "../../shared/types";

export interface MeetingPageAdapter {
  readonly provider: MeetingProvider;
  canHandle(url: string): boolean;
  getMeetingUrl(url: string): string | null;
  isInsideActiveMeeting(): boolean;
}
