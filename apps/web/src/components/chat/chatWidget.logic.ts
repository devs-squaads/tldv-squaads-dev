import type { DisplayMessage } from "@/components/chat/useChatStream";

// ponytail: content-substring coupling to the Soporte answer in ChatMessages.tsx
// (not a topic-id pipeline) so the button survives cache/DB restore, not just
// fresh clicks. Upgrade to a structured topic id if this marker ever collides.
export const SUPPORT_TOPIC_MARKER = "Reportar un problema";

export function hasSupportTopicMarker(messages: DisplayMessage[]): boolean {
  return messages.some(
    (m) => m.role === "assistant" && m.content.includes(SUPPORT_TOPIC_MARKER)
  );
}
