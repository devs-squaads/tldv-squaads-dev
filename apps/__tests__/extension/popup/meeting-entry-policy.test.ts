import { describe, expect, it } from "bun:test";
import { getPopupMeetingEntryDecision } from "../../../extension/src/popup/meeting-entry-policy";

describe("popup meeting entry policy", () => {
  it("keeps the recoverable transcription error subscribed and blocks another invite", () => {
    expect(getPopupMeetingEntryDecision("transcription_error")).toEqual({
      keepSubscription: true,
      allowInvite: false,
    });
  });

  it.each(["completed", "error"] as const)("preserves terminal behavior for %s", (status) => {
    expect(getPopupMeetingEntryDecision(status)).toEqual({
      keepSubscription: false,
      allowInvite: true,
    });
  });
});
