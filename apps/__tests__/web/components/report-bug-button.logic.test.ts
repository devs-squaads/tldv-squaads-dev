/// <reference types="bun" />

import { describe, expect, it } from "bun:test";
import {
  buildBugReportRequestBody,
  getBugReportModeNote,
  isBugReportSubmitDisabled,
  resolveBugReportFeedback,
} from "../../../web/src/components/bug-report/reportBugButton.logic";

describe("report bug button logic", () => {
  it("omits a meeting id and states that general reports have no diagnostics", () => {
    expect(buildBugReportRequestBody("  Chat is unavailable  ")).toEqual({ message: "Chat is unavailable" });
    expect(getBugReportModeNote()).toBe("Este reporte no incluye el diagnóstico de una reunión.");
  });

  it("includes a meeting id only for the meeting-attached flow", () => {
    expect(buildBugReportRequestBody("failed", "meeting-1")).toEqual({ message: "failed", meetingId: "meeting-1" });
    expect(getBugReportModeNote("meeting-1")).toBeNull();
  });

  it("disables empty and in-flight submissions, while mapping only sanitized feedback", () => {
    expect(isBugReportSubmitDisabled(" ", false)).toBe(true);
    expect(isBugReportSubmitDisabled("failed", true)).toBe(true);
    expect(resolveBugReportFeedback(false)).toEqual({ type: "error", text: "No pudimos enviar el reporte." });
  });
});
