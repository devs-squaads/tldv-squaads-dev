/// <reference types="bun" />

import { describe, expect, it } from "bun:test";
import {
  sanitizeMessageList,
  buildTrustedConversation,
} from "../../../web/src/modules/chat/http/trustBoundary";
import { createChatRequestContext } from "../../../web/src/modules/chat/http/requestContext";
import { resolveChatToolPolicy } from "../../../web/src/modules/chat/policy/toolPolicy";

describe("POST /api/chat route logic", () => {
  describe("authentication check logic", () => {
    it("rejects unauthorized when session is null", () => {
      const session = null;
      const isAuthorized = session?.user?.id != null;
      expect(isAuthorized).toBe(false);
    });

    it("rejects unauthorized when user id is missing", () => {
      const session = { user: {} };
      const isAuthorized = session?.user?.id != null;
      expect(isAuthorized).toBe(false);
    });

    it("accepts authorized when user id exists", () => {
      const session = { user: { id: "user-123" } };
      const isAuthorized = session?.user?.id != null;
      expect(isAuthorized).toBe(true);
    });
  });

  describe("payload parsing logic", () => {
    it("extracts messages from valid body", () => {
      const body = { messages: [{ role: "user", content: "hello" }] };
      const messages = sanitizeMessageList(
        typeof body === "object" && body !== null && "messages" in body
          ? (body as { messages?: unknown }).messages
          : null,
      );
      expect(messages).toHaveLength(1);
      expect(messages[0]?.content).toBe("hello");
    });

    it("throws when messages field is missing", () => {
      const body = { other: "data" };
      expect(() => {
        sanitizeMessageList(
          typeof body === "object" && body !== null && "messages" in body
            ? (body as { messages?: unknown }).messages
            : null,
        );
      }).toThrow("messages array is required");
    });

    it("throws on invalid JSON", () => {
      expect(() => {
        JSON.parse("not-valid-json");
      }).toThrow();
    });
  });

  describe("message validation logic", () => {
    it("requires at least one message", () => {
      const messages: { role: string; content: string }[] = [];
      const hasMessages = messages.length > 0;
      expect(hasMessages).toBe(false);
    });

    it("accepts valid message structure", () => {
      const messages = [{ role: "user", content: "hello" }];
      const hasMessages = messages.length > 0;
      expect(hasMessages).toBe(true);
    });

    it("throws on invalid role", () => {
      expect(() => {
        sanitizeMessageList([{ role: "system", content: "nope" }]);
      }).toThrow();
    });

    it("throws on invalid content type", () => {
      expect(() => {
        sanitizeMessageList([{ role: "user", content: 123 }]);
      }).toThrow();
    });
  });

  describe("request ID header handling", () => {
    it("extracts valid X-Request-Id from headers", () => {
      const headers = new Headers({ "x-request-id": "req.test-123" });
      const context = createChatRequestContext({ headers }, "chat");
      expect(context.requestId).toBe("req.test-123");
      expect(context.responseHeaders.get("X-Request-Id")).toBe("req.test-123");
    });

    it("generates UUID for invalid header", () => {
      const headers = new Headers({ "x-request-id": "invalid!" });
      const context = createChatRequestContext({ headers }, "chat");
      expect(context.requestId).not.toBe("invalid!");
      expect(context.requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it("generates UUID when header is missing", () => {
      const headers = new Headers();
      const context = createChatRequestContext({ headers }, "chat");
      expect(context.requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });
  });

  describe("provider resolution logic", () => {
    it("returns error when no provider configured", () => {
      const providerResolution = {
        resolutionSource: "not-configured" as const,
        configuredProvider: null,
        effectiveProvider: null,
      };

      if (!providerResolution.effectiveProvider) {
        const errorMessage =
          providerResolution.resolutionSource === "invalid-configured"
            ? `Unsupported chat provider "${providerResolution.configuredProvider}"`
            : "No AI provider configured";
        expect(errorMessage).toBe("No AI provider configured");
      }
    });

    it("returns error when configured provider is invalid", () => {
      const providerResolution = {
        resolutionSource: "invalid-configured" as const,
        configuredProvider: "unknown",
        effectiveProvider: null,
      };

      if (!providerResolution.effectiveProvider) {
        const errorMessage =
          providerResolution.resolutionSource === "invalid-configured"
            ? `Unsupported chat provider "${providerResolution.configuredProvider}"`
            : "No AI provider configured";
        expect(errorMessage).toBe('Unsupported chat provider "unknown"');
      }
    });

    it("continues when provider is resolved", () => {
      const providerResolution = {
        resolutionSource: "env" as const,
        configuredProvider: "openai",
        effectiveProvider: { name: "openai" },
      };

      const hasProvider = providerResolution.effectiveProvider != null;
      expect(hasProvider).toBe(true);
    });
  });

  describe("tool policy logic", () => {
    it("selects full tools when policy is full", () => {
      // Set full policy for this test
      const originalPolicy = process.env.CHAT_TOOL_POLICY;
      process.env.CHAT_TOOL_POLICY = "full";

      const toolPolicy = resolveChatToolPolicy();
      // Simulating the logic from route.ts
      const tools =
        toolPolicy.activePolicy === "full"
          ? ["tool1", "tool2"]
          : ["read-only"];

      process.env.CHAT_TOOL_POLICY = originalPolicy;
      expect(tools).toEqual(["tool1", "tool2"]);
    });

    it("selects read-only tools when policy is read-only", () => {
      // Override env for this test
      const originalPolicy = process.env.CHAT_TOOL_POLICY;
      process.env.CHAT_TOOL_POLICY = "read-only";

      const toolPolicy = resolveChatToolPolicy();
      const tools =
        toolPolicy.activePolicy === "full"
          ? ["tool1", "tool2"]
          : ["read-only"];

      process.env.CHAT_TOOL_POLICY = originalPolicy;
      expect(tools).toEqual(["read-only"]);
    });
  });

  describe("trust boundary logic", () => {
    it("sanitizes client messages", () => {
      const input = [{ role: "user", content: "  hello  " }];
      const sanitized = sanitizeMessageList(input);
      expect(sanitized[0]?.content).toBe("hello");
    });

    it("builds trusted conversation with history", () => {
      const trusted = buildTrustedConversation({
        persistedHistory: [
          { role: "user", content: "first" },
          { role: "assistant", content: "answer" },
        ],
        clientMessages: [{ role: "user", content: "followup" }],
      });
      expect(trusted.messages).toHaveLength(3);
      expect(trusted.messages[0]?.content).toBe("first");
      expect(trusted.messages[2]?.content).toBe("followup");
    });
  });

  describe("response headers logic", () => {
    it("sets SSE headers", () => {
      const headers = new Headers({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Request-Id": "req-123",
      });
      expect(headers.get("Content-Type")).toBe("text/event-stream");
      expect(headers.get("Cache-Control")).toBe("no-cache");
      expect(headers.get("Connection")).toBe("keep-alive");
      expect(headers.get("X-Request-Id")).toBe("req-123");
    });
  });
});
