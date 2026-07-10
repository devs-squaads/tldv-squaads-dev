/// <reference types="bun" />

import { describe, expect, it } from "bun:test";

import {
  MAX_MESSAGE_LENGTH,
  MAX_MESSAGES,
  MAX_TOTAL_CONTENT_CHARS,
} from "../../../web/src/modules/chat/http/contracts";
import {
  ChatTrustBoundaryError,
  buildTrustedConversation,
  sanitizeMessageList,
  sanitizePersistedHistory,
} from "../../../web/src/modules/chat/http/trustBoundary";

describe("chat trust boundary", () => {
  it("sanitizes valid client messages", () => {
    const sanitized = sanitizeMessageList(
      [
        { role: "user", content: "  hola  " },
        { role: "assistant", content: `  ${"x".repeat(MAX_MESSAGE_LENGTH + 50)}  ` },
      ],
      undefined,
      {
        redactText: (text) => text.replaceAll("hola", "[REDACTED]"),
      },
    );

    expect(sanitized).toEqual([
      { role: "user", content: "[REDACTED]" },
      { role: "assistant", content: "x".repeat(MAX_MESSAGE_LENGTH) },
    ]);
  });

  it("rejects invalid client roles or payloads", () => {
    expect(() =>
      sanitizeMessageList([
        { role: "system", content: "nope" },
      ])).toThrow(new ChatTrustBoundaryError("Invalid message role or content"));

    expect(() => sanitizeMessageList([{ role: "user", content: 123 }])).toThrow(
      new ChatTrustBoundaryError("Invalid message role or content"),
    );

    expect(() => sanitizeMessageList(["broken"]))
      .toThrow(new ChatTrustBoundaryError("Invalid message structure"));
  });

  it("enforces the maximum number of client messages by keeping the latest slice", () => {
    const input = Array.from({ length: MAX_MESSAGES + 5 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `message-${index}`,
    }));

    const sanitized = sanitizeMessageList(input);

    expect(sanitized).toHaveLength(MAX_MESSAGES);
    expect(sanitized[0]?.content).toBe("message-5");
    expect(sanitized.at(-1)?.content).toBe(`message-${MAX_MESSAGES + 4}`);
  });

  it("rejects client payloads that exceed the total content budget", () => {
    const oversized = Array.from({ length: 8 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: String(index).repeat(MAX_MESSAGE_LENGTH),
    }));

    expect(() => sanitizeMessageList(oversized)).toThrow(
      new ChatTrustBoundaryError("Message payload too large"),
    );
  });

  it("sanitizes persisted history by dropping invalid entries and normalizing valid ones", () => {
    const sanitized = sanitizePersistedHistory(
      [
        { role: "user", content: "  keep me  " },
        { role: "system", content: "drop me" },
        { role: "assistant", content: "   " },
        { role: "assistant", content: 123 },
        { role: "assistant", content: "  keep too  " },
      ],
      {
        redactText: (text) => text.replaceAll("keep me", "kept"),
      },
    );

    expect(sanitized).toEqual([
      { role: "user", content: "kept" },
      { role: "assistant", content: "keep too" },
    ]);
  });

  it("truncates persisted history from the oldest side to respect the total content budget", () => {
    const oversizedPersisted = Array.from({ length: 8 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `${index}`.repeat(MAX_MESSAGE_LENGTH),
    }));

    const sanitized = sanitizePersistedHistory(oversizedPersisted);

    expect(sanitized).toHaveLength(7);
    expect(sanitized[0]?.content).toBe("1".repeat(MAX_MESSAGE_LENGTH));
    expect(sanitized.at(-1)?.content).toBe("7".repeat(MAX_MESSAGE_LENGTH));
    expect(sanitized.reduce((total, message) => total + message.content.length, 0)).toBeLessThanOrEqual(
      MAX_TOTAL_CONTENT_CHARS,
    );
  });

  it("returns empty persisted history when the payload is missing", () => {
    expect(sanitizePersistedHistory(undefined)).toEqual([]);
  });

  it("builds a trusted conversation from sanitized persisted history plus the latest client tail", () => {
    const trusted = buildTrustedConversation({
      persistedHistory: [
        { role: "user", content: "  first question  " },
        { role: "assistant", content: "first answer" },
        { role: "system", content: "drop me" },
      ],
      clientMessages: [
        { role: "user", content: "older user" },
        { role: "assistant", content: "older assistant" },
        { role: "assistant", content: "draft reply" },
        { role: "user", content: "latest user" },
      ],
    });

    expect(trusted.messages).toEqual([
      { role: "user", content: "first question" },
      { role: "assistant", content: "first answer" },
      { role: "assistant", content: "draft reply" },
      { role: "user", content: "latest user" },
    ]);
    expect(trusted.supportContextHint).toEqual({
      source: "persisted-plus-client-tail",
      partial: true,
      messages: trusted.messages,
    });
  });

  it("deduplicates client tail entries already present at the end of persisted history", () => {
    const trusted = buildTrustedConversation({
      persistedHistory: [
        { role: "user", content: "persisted user" },
        { role: "assistant", content: "persisted answer" },
      ],
      clientMessages: [
        { role: "assistant", content: "persisted answer" },
        { role: "user", content: "new question" },
      ],
    });

    expect(trusted.messages).toEqual([
      { role: "user", content: "persisted user" },
      { role: "assistant", content: "persisted answer" },
      { role: "user", content: "new question" },
    ]);
  });
});
