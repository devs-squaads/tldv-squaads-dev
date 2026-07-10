import { googleMeetAdapter } from "./meet";
import { microsoftTeamsAdapter } from "./teams";
import { zoomWebAdapter } from "./zoom";
import type { MeetingPageAdapter } from "./types";

const ADAPTERS: MeetingPageAdapter[] = [googleMeetAdapter, microsoftTeamsAdapter, zoomWebAdapter];

export function pickAdapter(url: string): MeetingPageAdapter | null {
  return ADAPTERS.find((a) => a.canHandle(url)) || null;
}
