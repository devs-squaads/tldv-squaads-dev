import type { MeetingPageAdapter } from "./types";
import { normalizeMeetingUrl } from "../../shared/meeting-url";

export const googleMeetAdapter: MeetingPageAdapter = {
  provider: "google-meet",
  canHandle(url) {
    return url.includes("meet.google.com");
  },
  getMeetingUrl(url) {
    return normalizeMeetingUrl(url, "google-meet");
  },
  isInsideActiveMeeting() {
    const title = document.title.toLowerCase();
    const text = (document.body?.innerText || "").toLowerCase();
    if (title.includes("ready to join") || title.includes("join now")) return false;
    if (text.includes("join now") || text.includes("ask to join")) return false;
    return true;
  },
};
