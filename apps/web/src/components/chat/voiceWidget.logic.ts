/**
 * Lógica pura del widget de voz: etiquetas de estado, acumulación de
 * transcripciones y composición de los mensajes en vivo. La UI visual queda
 * fuera de los unit tests; esto sí se testea.
 *
 * Los turnos ya cerrados **no** se componen acá: entran al mismo estado de
 * `useChatStream` (vía `appendMessages`) y llegan por `messages`.
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

/** Agrega al final las transcripciones en vivo (parciales) del turno en curso. */
export function buildVoiceDisplayMessages(input: {
  messages: DisplayMessage[];
  liveUserText: string;
  liveAssistantText: string;
}): DisplayMessage[] {
  const liveMessages: DisplayMessage[] = [];

  const liveUserText = input.liveUserText.trim();
  const liveAssistantText = input.liveAssistantText.trim();

  if (liveUserText) {
    liveMessages.push({ role: "user", content: liveUserText });
  }
  if (liveAssistantText) {
    liveMessages.push({ role: "assistant", content: liveAssistantText, isStreaming: true });
  }

  return liveMessages.length > 0 ? [...input.messages, ...liveMessages] : input.messages;
}
