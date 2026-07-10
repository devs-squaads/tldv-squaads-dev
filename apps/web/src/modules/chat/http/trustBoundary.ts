import {
  ALLOWED_CLIENT_ROLES,
  ALLOWED_PERSISTED_ROLES,
  MAX_MESSAGE_LENGTH,
  MAX_MESSAGES,
  MAX_TOTAL_CONTENT_CHARS,
  type ClientChatMessage,
  type PersistableChatMessage,
  type PublicChatMessage,
  type PublicMessageRole,
  type TrustedConversation,
} from "@/modules/chat/http/contracts";

export class ChatTrustBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatTrustBoundaryError";
  }
}

export interface PiiRedactionHooks {
  redactText?: (text: string) => string;
}

interface SanitizeMessageListOptions {
  arrayRequired?: boolean;
  invalidItemMode?: "throw" | "drop";
  totalLimitMode?: "throw" | "truncate";
  allowedRoles?: readonly PublicMessageRole[];
}

const DEFAULT_SANITIZE_OPTIONS: Required<SanitizeMessageListOptions> = {
  arrayRequired: true,
  invalidItemMode: "throw",
  totalLimitMode: "throw",
  allowedRoles: ALLOWED_CLIENT_ROLES,
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function applyPiiRedactionBase(text: string, hooks?: PiiRedactionHooks): string {
  return hooks?.redactText?.(text) ?? text;
}

export function normalizeText(
  value: unknown,
  hooks?: PiiRedactionHooks,
): string | null {
  if (typeof value !== "string") return null;

  const redacted = applyPiiRedactionBase(value, hooks);
  const trimmed = redacted.trim();
  if (!trimmed) return null;

  return trimmed.slice(0, MAX_MESSAGE_LENGTH);
}

export function enforceTotalContentLimit<T extends PublicChatMessage>(
  messages: T[],
  mode: "throw" | "truncate" = "throw",
): T[] {
  if (mode === "throw") {
    const totalChars = messages.reduce((sum, message) => sum + message.content.length, 0);
    if (totalChars > MAX_TOTAL_CONTENT_CHARS) {
      throw new ChatTrustBoundaryError("Message payload too large");
    }

    return messages;
  }

  const kept: T[] = [];
  let totalChars = 0;

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    const nextTotal = totalChars + message.content.length;
    if (nextTotal > MAX_TOTAL_CONTENT_CHARS) break;
    kept.unshift(message);
    totalChars = nextTotal;
  }

  return kept;
}

export function sanitizeMessageList(
  input: unknown,
  options?: SanitizeMessageListOptions,
  hooks?: PiiRedactionHooks,
): PublicChatMessage[] {
  const resolvedOptions = { ...DEFAULT_SANITIZE_OPTIONS, ...options };

  if (!Array.isArray(input)) {
    if (!resolvedOptions.arrayRequired) return [];
    throw new ChatTrustBoundaryError("messages array is required");
  }

  const sanitized: PublicChatMessage[] = [];
  const sliced = input.slice(-MAX_MESSAGES);

  for (const rawMessage of sliced) {
    if (!isRecord(rawMessage)) {
      if (resolvedOptions.invalidItemMode === "throw") {
        throw new ChatTrustBoundaryError("Invalid message structure");
      }
      continue;
    }

    const role = rawMessage.role;
    const hasStringContent = typeof rawMessage.content === "string";
    const content = normalizeText(rawMessage.content, hooks);

    if (!resolvedOptions.allowedRoles.includes(role as PublicMessageRole) || !hasStringContent) {
      if (resolvedOptions.invalidItemMode === "throw") {
        throw new ChatTrustBoundaryError("Invalid message role or content");
      }
      continue;
    }

    if (!content) continue;

    sanitized.push({
      role: role as PublicMessageRole,
      content,
    });
  }

  return enforceTotalContentLimit(sanitized, resolvedOptions.totalLimitMode);
}

export function sanitizePersistedHistory(
  input: unknown,
  hooks?: PiiRedactionHooks,
): PersistableChatMessage[] {
  return sanitizeMessageList(
    input,
    {
      arrayRequired: false,
      invalidItemMode: "drop",
      totalLimitMode: "truncate",
      allowedRoles: ALLOWED_PERSISTED_ROLES,
    },
    hooks,
  );
}

export function buildTrustedConversation(input: {
  persistedHistory: unknown;
  clientMessages: ClientChatMessage[];
}): TrustedConversation {
  const persistedHistory = sanitizePersistedHistory(input.persistedHistory);
  const trustedMessages: PublicChatMessage[] = [...persistedHistory];

  let latestUserIndex = -1;
  for (let index = input.clientMessages.length - 1; index >= 0; index--) {
    if (input.clientMessages[index]?.role === "user") {
      latestUserIndex = index;
      break;
    }
  }

  const clientTail = latestUserIndex === -1
    ? []
    : input.clientMessages.slice(Math.max(0, latestUserIndex - 1), latestUserIndex + 1);

  for (const message of clientTail) {
    const lastTrusted = trustedMessages.at(-1);
    const shouldAppend =
      !lastTrusted ||
      lastTrusted.role !== message.role ||
      lastTrusted.content !== message.content;

    if (shouldAppend) {
      trustedMessages.push(message);
    }
  }

  const messages = enforceTotalContentLimit(trustedMessages, "truncate");
  const supportContextHint: TrustedConversation["supportContextHint"] = persistedHistory.length > 0
    ? {
        source: clientTail.length > 0 ? "persisted-plus-client-tail" : "persisted-history",
        partial: clientTail.length > 0,
        messages,
      }
    : clientTail.length > 0
      ? {
          source: "partial-client-context",
          partial: true,
          messages,
        }
      : {
          source: "empty",
          partial: false,
          messages,
        };

  return {
    messages,
    supportContextHint,
  };
}
