import type { ToolDefinition, ToolCallRequest } from "./tools/types";

// ─── Mensajes ─────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  /**
   * Solo en mensajes "assistant" que contienen tool calls (turno intermedio del loop).
   * El LLM los genera; nosotros los propagamos al historial.
   */
  toolCalls?: ToolCallRequest[];
  /**
   * Solo en mensajes "tool" — debe coincidir con el ToolCallRequest.id
   * para que el LLM sepa a qué call corresponde el resultado.
   */
  toolCallId?: string;
  /**
   * Solo en mensajes "tool" — nombre de la función ejecutada.
   * Requerido por Groq.
   */
  toolName?: string;
}

// ─── Suggestions (sistema existente — se mantiene) ───────────────────────────

export interface ChatSuggestion {
  label: string;
  action:
    | "view_meetings"
    | "view_meeting_detail"
    | "install_extension"
    | "view_transcription"
    | "open_settings";
  payload?: Record<string, string>;
}

// ─── Chunks del stream ────────────────────────────────────────────────────────

export interface ChatStreamChunk {
  text?: string;
  suggestions?: ChatSuggestion[];
  /**
   * Emitido durante el agentic loop para dar feedback al usuario.
   * status "calling" → la tool está ejecutándose.
   * status "done"    → terminó, el LLM sigue procesando.
   */
  toolCall?: { name: string; status: "calling" | "done" };
  done: boolean;
  error?: string;
}

// ─── Interfaz del provider ────────────────────────────────────────────────────

export interface ChatProvider {
  readonly name: string;

  /**
   * Streaming al cliente.
   * El runtime común (chatRuntimeCore) orquesta el agentic loop;
   * cada provider solo adapta mensajes/tools a su SDK y expone streams.
   */
  streamChat(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
  ): AsyncIterable<ChatStreamChunk>;
}
