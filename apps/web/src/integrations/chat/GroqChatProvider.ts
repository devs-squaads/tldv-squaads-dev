import Groq from "groq-sdk";
import type { ChatMessage, ChatProvider, ChatStreamChunk } from "@/integrations/chat/ChatProvider";
import type { ToolDefinition, ToolCallRequest } from "@/integrations/chat/tools/types";
import {
  streamChatRuntime,
  type ChatRuntimeAdapter,
} from "@/modules/chat/application/chatRuntimeCore";

// Modelo con tool calling confiable para el agentic loop
const MODEL_AGENTIC = "llama-3.3-70b-versatile";
// Modelo rápido y barato para el stream final (solo formateo de texto)
const MODEL_STREAM = "llama-3.1-8b-instant";

// ─── Adaptadores de tipos ─────────────────────────────────────────────────────

function toGroqTool(tool: ToolDefinition): Groq.Chat.Completions.ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      // ToolParameterSchema es incompatible directo — pasamos por unknown
      parameters: tool.parameters as unknown as Record<string, unknown>,
    },
  };
}

function toGroqMessage(m: ChatMessage): Groq.Chat.Completions.ChatCompletionMessageParam {
  if (m.role === "tool") {
    return {
      role: "tool",
      tool_call_id: m.toolCallId ?? "",
      content: m.content,
    };
  }

  if (m.role === "assistant" && m.toolCalls?.length) {
    return {
      role: "assistant",
      content: m.content || null,
      tool_calls: m.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: tc.arguments },
      })),
    };
  }

  return { role: m.role, content: m.content } as Groq.Chat.Completions.ChatCompletionMessageParam;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export class GroqChatProvider implements ChatProvider {
  readonly name = "groq";

  async *streamChat(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
  ): AsyncIterable<ChatStreamChunk> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY not configured");

    const groq = new Groq({ apiKey });

    const runtimeAdapter: ChatRuntimeAdapter = {
      completeTurn: async ({ history, tools: loopTools, requireToolCall }) => {
        const response = await groq.chat.completions.create({
          model: MODEL_AGENTIC,
          messages: history.map(toGroqMessage),
          tools: loopTools.map(toGroqTool),
          tool_choice: requireToolCall ? "required" : "auto",
          temperature: 0.4,
          max_tokens: 2048,
          stream: false,
        });

        const choice = response.choices[0];
        if (!choice) {
          return { type: "final" };
        }

        if (choice.finish_reason === "tool_calls" && choice.message.tool_calls?.length) {
          const toolCalls: ToolCallRequest[] = choice.message.tool_calls.map((toolCall) => ({
            id: toolCall.id,
            name: toolCall.function.name,
            arguments: toolCall.function.arguments,
          }));

          return {
            type: "tool_calls",
            toolCalls,
            assistantContent: choice.message.content ?? "",
          };
        }

        return { type: "final" };
      },

      streamFinalText: async function* (history) {
        const stream = await groq.chat.completions.create({
          model: MODEL_STREAM,
          messages: history.map(toGroqMessage),
          tool_choice: "none",
          temperature: 0.4,
          max_tokens: 2048,
          stream: true,
        });

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content ?? "";
          if (delta) yield delta;
        }
      },

      streamDirectText: async function* (history) {
        const stream = await groq.chat.completions.create({
          model: MODEL_STREAM,
          messages: history.map(toGroqMessage),
          temperature: 0.4,
          max_tokens: 2048,
          stream: true,
        });

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content ?? "";
          if (delta) yield delta;
        }
      },
    };

    yield* streamChatRuntime(runtimeAdapter, messages, tools ?? []);
  }
}
