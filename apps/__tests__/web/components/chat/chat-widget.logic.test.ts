import { describe, expect, test } from "bun:test";
import { hasSupportTopicMarker, SUPPORT_TOPIC_MARKER } from "../../../../web/src/components/chat/chatWidget.logic";
import type { DisplayMessage } from "../../../../web/src/components/chat/useChatStream";

describe("hasSupportTopicMarker", () => {
  test("false for an empty message list (fresh mount / after reset)", () => {
    expect(hasSupportTopicMarker([])).toBe(false);
  });

  test("true when a restored assistant message contains the marker", () => {
    const messages: DisplayMessage[] = [
      { role: "user", content: "¿Cómo puedo contactar al equipo de soporte?" },
      { role: "assistant", content: `Algo de texto.\n\n${SUPPORT_TOPIC_MARKER} que aparece debajo.` },
    ];
    expect(hasSupportTopicMarker(messages)).toBe(true);
  });

  test("false when only a user message contains the marker text", () => {
    const messages: DisplayMessage[] = [
      { role: "user", content: `Quiero ${SUPPORT_TOPIC_MARKER}` },
    ];
    expect(hasSupportTopicMarker(messages)).toBe(false);
  });

  test("false when assistant messages don't mention the marker", () => {
    const messages: DisplayMessage[] = [
      { role: "user", content: "¿Cómo gestiono mis reuniones?" },
      { role: "assistant", content: "Desde el dashboard podés gestionar tus reuniones." },
    ];
    expect(hasSupportTopicMarker(messages)).toBe(false);
  });
});
