import { describe, expect, it } from "bun:test";

import { resolveMeetingDisplayName } from "../../../web/src/components/adminShareRequests.logic";

const baseMeeting = { name: null, botName: null, url: "https://meet.google.com/abc-defg-hij", createdAt: new Date("2026-01-15T00:00:00Z") };

describe("resolveMeetingDisplayName — admin pending-requests meeting label", () => {
  it("prefers botName when present", () => {
    expect(resolveMeetingDisplayName({ ...baseMeeting, botName: "Squaads Bot", name: "Weekly Sync" })).toBe(
      "Squaads Bot",
    );
  });

  it("falls back to name when there is no botName", () => {
    expect(resolveMeetingDisplayName({ ...baseMeeting, name: "Weekly Sync" })).toBe("Weekly Sync");
  });

  it("falls back to the meeting url when both botName and name are empty (never the raw id)", () => {
    expect(resolveMeetingDisplayName(baseMeeting)).toBe("https://meet.google.com/abc-defg-hij");
  });

  it("falls back to the createdAt date when url is also empty", () => {
    expect(resolveMeetingDisplayName({ ...baseMeeting, url: "" })).toBe("2026-01-15");
  });

  it("returns a deleted-meeting label when the referenced meeting no longer exists", () => {
    expect(resolveMeetingDisplayName(null)).toBe("Reunión eliminada");
  });
});
