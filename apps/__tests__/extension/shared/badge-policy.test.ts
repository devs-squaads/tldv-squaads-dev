import { describe, expect, it } from "bun:test";
import { resolveBadgeState } from "../../../extension/src/shared/badge-policy";

describe("resolveBadgeState", () => {
  it("shows the recording badge while recording", () => {
    expect(resolveBadgeState("recording")).toBe("recording");
  });

  it("shows the error badge for a recoverable transcription error", () => {
    expect(resolveBadgeState("transcription_error")).toBe("error");
  });

  it("shows the error badge for a terminal error", () => {
    expect(resolveBadgeState("error")).toBe("error");
  });

  it.each(["pending", "joining", "waiting_admission", "transcribing", "summarizing"] as const)(
    "clears the badge for %s",
    (status) => {
      expect(resolveBadgeState(status)).toBe("clear");
    },
  );

  it("clears the badge when there is no status", () => {
    expect(resolveBadgeState(null)).toBe("clear");
  });
});
