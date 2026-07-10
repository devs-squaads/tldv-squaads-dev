export const MAX_MESSAGES = 30;
export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_TOTAL_CONTENT_CHARS = 30000;

export const ALLOWED_CLIENT_ROLES = ["user", "assistant"] as const;
export const ALLOWED_PERSISTED_ROLES = ["user", "assistant"] as const;

export type PublicMessageRole = (typeof ALLOWED_CLIENT_ROLES)[number];

export interface PublicChatMessage {
  role: PublicMessageRole;
  content: string;
}

export type ClientChatMessage = PublicChatMessage;
export type PersistableChatMessage = PublicChatMessage;

export interface PublicChatMessagesPayload {
  messages: PublicChatMessage[];
}

export interface PublicSupportContextPayload {
  userMessage: string;
  chatHistory?: PublicChatMessage[];
}

export type SupportContextSource =
  | "persisted-history"
  | "persisted-plus-client-tail"
  | "partial-client-context"
  | "empty";

export interface SupportContextHint {
  source: SupportContextSource;
  partial: boolean;
  messages: PublicChatMessage[];
}

export interface TrustedConversation {
  messages: PublicChatMessage[];
  supportContextHint: SupportContextHint;
}
