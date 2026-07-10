import { describe, expect, it } from "bun:test";
import { googleMeetAdapter } from "../../../extension/src/content/adapters/meet";
import { microsoftTeamsAdapter } from "../../../extension/src/content/adapters/teams";
import { zoomWebAdapter } from "../../../extension/src/content/adapters/zoom";

describe("extension adapters", () => {
  it("google adapter handles and normalizes meet URLs", () => {
    const url = "https://meet.google.com/abc-defg-hij?authuser=2";
    expect(googleMeetAdapter.canHandle(url)).toBe(true);
    expect(googleMeetAdapter.getMeetingUrl(url)).toBe("https://meet.google.com/abc-defg-hij");
  });

  it("teams adapter handles and normalizes teams URLs", () => {
    const url = "https://teams.microsoft.com/l/meetup-join/abc123/#/tab/";
    expect(microsoftTeamsAdapter.canHandle(url)).toBe(true);
    expect(microsoftTeamsAdapter.getMeetingUrl(url)).toBe("https://teams.microsoft.com/l/meetup-join/abc123");
  });

  it("zoom adapter handles and normalizes zoom URLs", () => {
    const url = "https://app.zoom.us/wc/123456/join/#/";
    expect(zoomWebAdapter.canHandle(url)).toBe(true);
    expect(zoomWebAdapter.getMeetingUrl(url)).toBe("https://app.zoom.us/wc/123456/join");
  });
});
