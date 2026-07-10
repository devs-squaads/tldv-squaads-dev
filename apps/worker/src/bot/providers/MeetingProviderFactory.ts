import { Browser, Page } from "puppeteer-core";
import { GoogleMeet } from "./meet/GoogleMeet";
import { OnlineMeetingProvider } from "./OnlineMeetingProvider";
import { MicrosoftTeams } from "./teams/MicrosoftTeams";
import { getMeetingProviderFromUrl } from "@meeting-bot/shared/meetingProvider";
import { ZoomMeeting } from "./zoom/ZoomMeeting";

export class MeetingProviderFactory {
  static from(url: string, page: Page, browser: Browser): OnlineMeetingProvider {
    switch (getMeetingProviderFromUrl(url)) {
      case "google-meet":
        return new GoogleMeet(page, browser);
      case "microsoft-teams":
        return new MicrosoftTeams(page, browser);
      case "zoom":
        return new ZoomMeeting(page, browser);
      default:
        throw new Error("Could not find a provider for this url");
    }
  }
}
