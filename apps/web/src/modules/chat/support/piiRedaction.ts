import type { PiiRedactionHooks } from "@/modules/chat/http/trustBoundary";

export function createSupportPiiRedactionHooks(): PiiRedactionHooks {
  return {
    redactText: (text) => text,
  };
}
