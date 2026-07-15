import type { ChatProviderName, ChatProviderResolution } from "@/integrations/chat/ChatProviderFactory";

export const CHAT_OBSERVABILITY_EVENTS = {
  chat: {
    requestReceived: "chat.request.received",
    payloadInvalid: "chat.payload.invalid",
    providerResolved: "chat.provider.resolved",
    streamStarted: "chat.stream.started",
    streamCompleted: "chat.stream.completed",
  },
  chatHistory: {
    requestReceived: "chat_history.request.received",
    payloadInvalid: "chat_history.payload.invalid",
    readCompleted: "chat_history.read.completed",
    writeCompleted: "chat_history.write.completed",
    deleteCompleted: "chat_history.delete.completed",
  },
  support: {
    requestReceived: "support.request.received",
    payloadInvalid: "support.payload.invalid",
  },
  bugReport: {
    requestReceived: "bug_report.request.received",
    payloadInvalid: "bug_report.payload.invalid",
    submitted: "bug_report.submitted",
  },
} as const;

export type ChatObservabilityRoute = keyof typeof CHAT_OBSERVABILITY_EVENTS;

export interface ChatProviderResolutionLogMetadata {
  configuredProvider: string | null;
  effectiveProvider: ChatProviderName | null;
  fallbackProvider: ChatProviderName | null;
  resolutionSource: ChatProviderResolution["resolutionSource"];
}

export function buildChatProviderResolutionLogMetadata(
  resolution: ChatProviderResolution,
): ChatProviderResolutionLogMetadata {
  return {
    configuredProvider: resolution.configuredProvider,
    effectiveProvider: resolution.effectiveProvider,
    fallbackProvider: resolution.fallbackProvider,
    resolutionSource: resolution.resolutionSource,
  };
}
