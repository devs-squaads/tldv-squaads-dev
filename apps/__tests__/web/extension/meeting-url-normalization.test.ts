import { describe, expect, it } from "bun:test";
import { detectMeetingProvider, normalizeMeetingUrl } from "../../../extension/src/shared/meeting-url";

describe("extension meeting URL normalization", () => {
  it("detects provider from URL", () => {
    expect(detectMeetingProvider("https://meet.google.com/abc-defg-hij")).toBe("google-meet");
    expect(detectMeetingProvider("https://teams.microsoft.com/l/meetup-join/123")).toBe("microsoft-teams");
    expect(detectMeetingProvider("https://app.zoom.us/wc/123456/join")).toBe("zoom");
    expect(detectMeetingProvider("https://example.com")).toBeNull();
  });

  it("normalizes Google Meet to canonical meeting code URL", () => {
    const normalized = normalizeMeetingUrl(
      "https://meet.google.com/abc-defg-hij?authuser=1&hs=122",
      "google-meet"
    );
    expect(normalized).toBe("https://meet.google.com/abc-defg-hij");
  });

  it("normalizes Teams URL by removing hash and trailing slash", () => {
    const normalized = normalizeMeetingUrl(
      "https://teams.microsoft.com/l/meetup-join/abc123/#/tab/",
      "microsoft-teams"
    );
    expect(normalized).toBe("https://teams.microsoft.com/l/meetup-join/abc123");
  });

  it("normalizes Zoom URL by removing hash and trailing slash", () => {
    const normalized = normalizeMeetingUrl("https://app.zoom.us/wc/123456/join/#/", "zoom");
    expect(normalized).toBe("https://app.zoom.us/wc/123456/join");
  });
});
