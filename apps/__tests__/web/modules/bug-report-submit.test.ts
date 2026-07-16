/// <reference types="bun" />

import { describe, expect, it } from "bun:test";
import {
  mapSubmitBugReportResultToResponse,
  requireRedactText,
  submitBugReport,
} from "../../../web/src/modules/bug-report/application/submitBugReport";
import type { SupportNotification } from "../../../web/src/integrations/support/SupportProvider";

function createProvider() {
  const sent: SupportNotification[] = [];
  return {
    sent,
    provider: { name: "fake", deliver: async (report: SupportNotification) => sent.push(report) },
  };
}

const unreachable = (label: string) => async () => { throw new Error(`must not be called: ${label}`); };

describe("submitBugReport", () => {
  it("rate-limits before a meeting lookup", async () => {
    const { provider, sent } = createProvider();
    const result = await submitBugReport(
      { userId: "user-1", message: "Recording failed", meetingId: "meeting-1" },
      { findMeetingById: unreachable("lookup"), provider, redactText: (text) => text, consumeRateLimit: () => false },
    );

    expect(result).toEqual({ status: "rate-limited" });
    expect(sent).toHaveLength(0);
  });

  it("delivers only allowlisted and redacted meeting diagnostics", async () => {
    const { provider, sent } = createProvider();
    const result = await submitBugReport(
      { userId: "user-1", userEmail: "reporter@example.com", message: "Contact leak@example.com", meetingId: "550e8400-e29b-41d4-a716-446655440000" },
      {
        findMeetingById: async () => ({
          id: "550e8400-e29b-41d4-a716-446655440000",
          organizerEmail: "reporter@example.com",
          status: "error",
          errorMessage: "Bearer FAKE1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
          sourceProvider: "google-meet",
          startsAt: new Date("2026-01-01T10:00:00Z"),
          endsAt: null,
        }),
        provider,
        redactText: (text) => text.replace(/leak@example\.com|Bearer FAKE1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ/g, "[REDACTED]"),
        consumeRateLimit: () => true,
      },
    );

    expect(result).toEqual({ status: "ok" });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      reporterId: "user-1",
      message: "Contact [REDACTED]",
      diagnostic: {
        kind: "meeting",
        meetingId: "550e8400-e29b-41d4-a716-446655440000",
        status: "error",
        errorMessage: "[REDACTED]",
        sourceProvider: "google-meet",
        startsAt: new Date("2026-01-01T10:00:00Z"),
        endsAt: null,
      },
    });
  });

  it("does not deliver diagnostics for a meeting owned by another user", async () => {
    const { provider, sent } = createProvider();
    const result = await submitBugReport(
      { userId: "user-1", userEmail: "reporter@example.com", message: "Recording failed", meetingId: "meeting-2" },
      { findMeetingById: async () => ({ id: "meeting-2", organizerEmail: "owner@example.com", status: "error", errorMessage: "private failure", sourceProvider: null, startsAt: null, endsAt: null }), provider, redactText: (text) => text, consumeRateLimit: () => true },
    );

    expect(result).toEqual({ status: "not-found" });
    expect(sent).toHaveLength(0);
  });

  it("labels a general report as non-diagnostic without lookup", async () => {
    const { provider, sent } = createProvider();
    const result = await submitBugReport(
      { userId: "user-1", message: "Chat is unavailable" },
      { findMeetingById: unreachable("lookup"), provider, redactText: (text) => text, consumeRateLimit: () => true },
    );

    expect(result).toEqual({ status: "ok" });
    expect(sent[0]?.diagnostic).toEqual({ kind: "none" });
  });

  it("rejects invalid input before consuming an allowance", async () => {
    const { provider, sent } = createProvider();
    const result = await submitBugReport(
      { userId: "user-1", message: "  " },
      { findMeetingById: unreachable("lookup"), provider, redactText: (text) => text, consumeRateLimit: () => { throw new Error("must not consume"); } },
    );

    expect(result).toEqual({ status: "invalid", reason: "message is required" });
    expect(sent).toHaveLength(0);
  });

  it("returns safe outcomes for unknown meetings and delivery failures", async () => {
    const { provider } = createProvider();
    const notFound = await submitBugReport(
      { userId: "user-1", message: "missing", meetingId: "missing" },
      { findMeetingById: async () => null, provider, redactText: (text) => text, consumeRateLimit: () => true },
    );
    expect(notFound).toEqual({ status: "not-found" });
    expect(mapSubmitBugReportResultToResponse(notFound)).toEqual({ statusCode: 404, body: { error: "Meeting not found" } });
  });

  it("fails closed when the required redaction hook is unavailable", () => {
    expect(() => requireRedactText({})).toThrow("Bug report PII redaction hook is not configured");
  });
});
