/**
 * Lógica pura del widget de voz: etiquetas de estado, acumulación de
 * transcripciones y composición de los mensajes a mostrar. La UI visual queda
 * fuera de los unit tests; esto sí se testea.
 */

import type { DisplayMessage } from "@/components/chat/useChatStream";
import type {
  VoiceActivity,
  VoiceSessionStatus,
} from "@/modules/chat/voice/voiceSessionState";

export interface VoiceTranscriptTurn {
  role: "user" | "assistant";
  content: string;
}

export function voiceStatusLabel(
  status: VoiceSessionStatus,
  activity: VoiceActivity,
): string {
  switch (status) {
    case "requesting-token":
      return "Pidiendo acceso...";
    case "connecting":
      return "Conectando...";
    case "active":
      return activity === "speaking" ? "Hablando..." : "Escuchando...";
    case "reconnecting":
      return "Reconectando...";
    case "ended":
      return "Sesión finalizada";
    case "error":
      return "Error de voz";
    case "idle":
    default:
      return "Voz lista";
  }
}

/**
 * Gemini Live puede mandar la transcripción acumulada o como delta según el
 * evento. Esta heurística soporta ambas sin duplicar texto.
 */
export function mergeTranscriptText(current: string, incoming: string): string {
  if (!incoming) return current;
  if (!current) return incoming;
  if (incoming === current) return current;
  if (incoming.startsWith(current)) return incoming;
  return current + incoming;
}

export function buildVoiceDisplayMessages(input: {
  messages: DisplayMessage[];
  turns: VoiceTranscriptTurn[];
  liveUserText: string;
  liveAssistantText: string;
}): DisplayMessage[] {
  const voiceMessages: DisplayMessage[] = input.turns.map((turn) => ({
    role: turn.role,
    content: turn.content,
  }));

  const liveUserText = input.liveUserText.trim();
  const liveAssistantText = input.liveAssistantText.trim();

  if (liveUserText) {
    voiceMessages.push({ role: "user", content: liveUserText });
  }
  if (liveAssistantText) {
    voiceMessages.push({ role: "assistant", content: liveAssistantText, isStreaming: true });
  }

  return voiceMessages.length > 0 ? [...input.messages, ...voiceMessages] : input.messages;
}
