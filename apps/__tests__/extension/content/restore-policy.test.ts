import { describe, expect, it } from "bun:test";
import { planWidgetRestore } from "../../../extension/src/content/restore-policy";

describe("widget restore policy", () => {
  it("expands the widget that is still mounted", () => {
    expect(planWidgetRestore(true, true)).toEqual({ action: "expand" });
  });

  it("rebuilds when the widget was torn down but the tab is still a meeting", () => {
    expect(planWidgetRestore(false, true)).toEqual({ action: "rebuild" });
  });

  it("rejects instead of reporting a success the user cannot see", () => {
    expect(planWidgetRestore(false, false)).toEqual({
      action: "reject",
      reason: "No meeting detected in this tab.",
    });
  });
});
