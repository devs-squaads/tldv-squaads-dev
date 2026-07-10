import type { NextRequest } from "next/server";
import {
  CHAT_OBSERVABILITY_EVENTS,
  type ChatObservabilityRoute,
} from "@/modules/chat/observability/events";

const REQUEST_ID_HEADER = "x-request-id";
const RESPONSE_REQUEST_ID_HEADER = "X-Request-Id";
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

export interface ChatRequestContext {
  requestId: string;
  route: ChatObservabilityRoute;
  responseHeaders: Headers;
  observability: {
    route: ChatObservabilityRoute;
    events: (typeof CHAT_OBSERVABILITY_EVENTS)[ChatObservabilityRoute];
    requestId: string;
  };
}

function normalizeIncomingRequestId(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return REQUEST_ID_PATTERN.test(trimmed) ? trimmed : null;
}

export function createChatRequestContext(
  request: Pick<NextRequest, "headers">,
  route: ChatObservabilityRoute,
): ChatRequestContext {
  const requestId = normalizeIncomingRequestId(request.headers.get(REQUEST_ID_HEADER)) ?? crypto.randomUUID();
  const responseHeaders = new Headers({
    [RESPONSE_REQUEST_ID_HEADER]: requestId,
  });

  return {
    requestId,
    route,
    responseHeaders,
    observability: {
      route,
      events: CHAT_OBSERVABILITY_EVENTS[route],
      requestId,
    },
  };
}

export function withChatRequestHeaders(
  context: ChatRequestContext,
  headersInit?: HeadersInit,
): Headers {
  const headers = new Headers(headersInit);
  context.responseHeaders.forEach((value, key) => {
    headers.set(key, value);
  });
  return headers;
}

export function jsonWithChatRequestContext(
  context: ChatRequestContext,
  body: unknown,
  init?: ResponseInit,
): Response {
  const headers = withChatRequestHeaders(context, init?.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}
