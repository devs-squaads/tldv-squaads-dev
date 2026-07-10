import { afterEach, describe, expect, it, mock } from "bun:test";
import { CHAT_OBSERVABILITY_EVENTS } from "../../../web/src/modules/chat/observability/events";
import {
  createChatRequestContext,
  jsonWithChatRequestContext,
} from "../../../web/src/modules/chat/http/requestContext";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("createChatRequestContext", () => {
  afterEach(() => {
    mock.restore();
  });

  it("uses a valid x-request-id header as-is", () => {
    const context = createChatRequestContext(
      { headers: new Headers({ "x-request-id": "req.chat-12345" }) },
      "chat",
    );

    expect(context.requestId).toBe("req.chat-12345");
    expect(context.route).toBe("chat");
    expect(context.responseHeaders.get("X-Request-Id")).toBe("req.chat-12345");
    expect(context.observability).toEqual({
      route: "chat",
      events: CHAT_OBSERVABILITY_EVENTS.chat,
      requestId: "req.chat-12345",
    });
  });

  it("generates a UUID when the header is missing", () => {
    const context = createChatRequestContext({ headers: new Headers() }, "chat");

    expect(context.requestId).toMatch(UUID_PATTERN);
    expect(context.responseHeaders.get("X-Request-Id")).toBe(context.requestId);
    expect(context.observability.requestId).toBe(context.requestId);
  });

  it("generates a UUID when the incoming header is invalid", () => {
    const context = createChatRequestContext(
      { headers: new Headers({ "x-request-id": "bad id" }) },
      "chat",
    );

    expect(context.requestId).toMatch(UUID_PATTERN);
    expect(context.requestId === "bad id").toBe(false);
    expect(context.responseHeaders.get("X-Request-Id")).toBe(context.requestId);
  });

  it("builds the expected observability context for chat history routes", () => {
    const context = createChatRequestContext(
      { headers: new Headers({ "x-request-id": "history.req-1234" }) },
      "chatHistory",
    );

    expect(context.requestId).toBe("history.req-1234");
    expect(context.route).toBe("chatHistory");
    expect(context.observability.route).toBe("chatHistory");
    expect(context.observability.events).toEqual(CHAT_OBSERVABILITY_EVENTS.chatHistory);
    expect(context.observability.requestId).toBe("history.req-1234");
  });
});

describe("jsonWithChatRequestContext", () => {
  it("adds the request header and a default JSON content type", async () => {
    const context = createChatRequestContext(
      { headers: new Headers({ "x-request-id": "req.response-1234" }) },
      "chat",
    );

    const response = jsonWithChatRequestContext(context, { ok: true }, { status: 202 });

    expect(response.status).toBe(202);
    expect(response.headers.get("X-Request-Id")).toBe("req.response-1234");
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(await response.json()).toEqual({ ok: true });
  });
});
