import type { MeetingPageAdapter } from "./types";
import { normalizeMeetingUrl } from "../../shared/meeting-url";

export const zoomWebAdapter: MeetingPageAdapter = {
  provider: "zoom",
  canHandle(url) {
    return url.includes("zoom.us") || url.includes(".zoom.com");
  },
  getMeetingUrl(url) {
    return normalizeMeetingUrl(url, "zoom");
  },
  isInsideActiveMeeting() {
    const href = window.location.href.toLowerCase();
    const bodyText = (document.body?.innerText || "").toLowerCase();
    if (bodyText.includes("join meeting") || bodyText.includes("unirse a la reunion")) return false;
    return href.includes("/wc/") || bodyText.includes("in meeting") || bodyText.includes("en reunion");
  },
};
