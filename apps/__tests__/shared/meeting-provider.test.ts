import { describe, expect, it } from "bun:test";
import {
  buildNamedRecordingStorageKey,
  sanitizeMeetingNameForStorageKey,
} from "../../../packages/shared/src/meetingProvider";

describe("sanitizeMeetingNameForStorageKey", () => {
  it("lowercases and replaces whitespace with a single separator", () => {
    expect(sanitizeMeetingNameForStorageKey("Daily   Standup")).toBe("daily-standup");
  });

  it("strips special characters and collapses repeated separators", () => {
    expect(sanitizeMeetingNameForStorageKey("  Q3 Planning!! Review??  ")).toBe("q3-planning-review");
  });

  it("replaces path-like separators (slashes/backslashes)", () => {
    expect(sanitizeMeetingNameForStorageKey("Team/Sync\\Notes")).toBe("team-sync-notes");
  });

  it.each([null, undefined, "", "   "])("falls back to 'meeting' for %p", (name) => {
    expect(sanitizeMeetingNameForStorageKey(name)).toBe("meeting");
  });
});

describe("buildNamedRecordingStorageKey", () => {
  it("builds provider/name_date_id.mp4 from a sanitized name", () => {
    const key = buildNamedRecordingStorageKey(
      "meeting-123",
      "Daily Standup",
      new Date("2026-07-20T10:00:00Z"),
      "https://meet.google.com/abc-defg-hij",
    );
    expect(key).toBe("google-meet/daily-standup_2026-07-20_meeting-123.mp4");
  });

  it("falls back to the 'meeting' placeholder when the name is null", () => {
    const key = buildNamedRecordingStorageKey(
      "meeting-456",
      null,
      new Date("2026-01-05T23:59:00Z"),
      "https://teams.microsoft.com/l/meetup-join/123",
    );
    expect(key).toBe("microsoft-teams/meeting_2026-01-05_meeting-456.mp4");
  });
});
