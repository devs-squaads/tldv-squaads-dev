import type { MeetingPageAdapter } from "./types";
import { normalizeMeetingUrl } from "../../shared/meeting-url";

export const microsoftTeamsAdapter: MeetingPageAdapter = {
  provider: "microsoft-teams",
  canHandle(url) {
    return url.includes("teams.microsoft.com");
  },
  getMeetingUrl(url) {
    return normalizeMeetingUrl(url, "microsoft-teams");
  },
  isInsideActiveMeeting() {
    const bodyText = (document.body?.innerText || "").toLowerCase();
    if (bodyText.includes("join now") || bodyText.includes("unirse ahora")) return false;
    if (bodyText.includes("waiting in the lobby") || bodyText.includes("esperando en el vestibulo")) return true;
    return bodyText.includes("meeting") || bodyText.includes("reunion");
  },
};
