import type { PiiRedactionHooks } from "@/modules/chat/http/trustBoundary";

const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const URL_QUERY_OR_FRAGMENT_PATTERN = /(https?:\/\/[^\s?#]+)([?#])[^\s]+/g;
const BEARER_TOKEN_PATTERN = /\bBearer\s+[\w.-]{8,}/gi;
const OPAQUE_BLOB_PATTERN = /(?<![\w+/=-])[\w+/=-]{32,}(?![\w+/=-])/g;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function redactText(text: string): string {
  let redacted = text.replace(EMAIL_PATTERN, "[REDACTED_EMAIL]");
  redacted = redacted.replace(URL_QUERY_OR_FRAGMENT_PATTERN, "$1$2[REDACTED]");
  redacted = redacted.replace(BEARER_TOKEN_PATTERN, "Bearer [REDACTED_TOKEN]");
  return redacted.replace(OPAQUE_BLOB_PATTERN, (match) => UUID_PATTERN.test(match) ? match : "[REDACTED_TOKEN]");
}

export function createSupportPiiRedactionHooks(): PiiRedactionHooks {
  return {
    redactText,
  };
}
