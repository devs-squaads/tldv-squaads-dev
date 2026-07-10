import { describe, expect, it } from "bun:test";
import { MeetingProviderFactory } from "../../../worker/src/bot/providers/MeetingProviderFactory";
import { GoogleMeet } from "../../../worker/src/bot/providers/meet/GoogleMeet";
import { MicrosoftTeams } from "../../../worker/src/bot/providers/teams/MicrosoftTeams";
import { ZoomMeeting } from "../../../worker/src/bot/providers/zoom/ZoomMeeting";

describe("MeetingProviderFactory", () => {
  it("returns GoogleMeet for Meet URLs", () => {
    const provider = MeetingProviderFactory.from(
      "https://meet.google.com/abc-defg-hij",
      {} as never,
      {} as never
    );
    expect(provider).toBeInstanceOf(GoogleMeet);
  });

  it("returns MicrosoftTeams for Teams URLs", () => {
    const provider = MeetingProviderFactory.from(
      "https://teams.microsoft.com/l/meetup-join/123",
      {} as never,
      {} as never
    );
    expect(provider).toBeInstanceOf(MicrosoftTeams);
  });

  it("returns ZoomMeeting for Zoom URLs", () => {
    const provider = MeetingProviderFactory.from(
      "https://app.zoom.us/wc/123456/join",
      {} as never,
      {} as never
    );
    expect(provider).toBeInstanceOf(ZoomMeeting);
  });
});
