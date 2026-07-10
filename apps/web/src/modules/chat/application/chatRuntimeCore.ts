import type { ChatMessage, ChatStreamChunk, ChatSuggestion } from "@/integrations/chat/ChatProvider";
import type { ToolDefinition, ToolCallRequest } from "@/integrations/chat/tools/types";
import { buildDeterministicOperationalDateResponse } from "@/modules/chat/application/operationalDateResponse";
import {
  buildDeterministicDateSuggestions,
  requiresDataTool,
  validateSuggestions,
  type ExecutedToolResult,
} from "@/integrations/chat/tools/suggestionValidator";

const MAX_TOOL_TURNS = 5;

export interface ChatTurnExecution {
  type: "tool_calls" | "final";
  toolCalls?: ToolCallRequest[];
  assistantContent?: string;
}

export interface ChatRuntimeAdapter {
  completeTurn(input: {
    history: ChatMessage[];
    tools: ToolDefinition[];
    requireToolCall: boolean;
    turn: number;
  }): Promise<ChatTurnExecution>;
  streamFinalText(history: ChatMessage[]): AsyncIterable<string>;
  streamDirectText(messages: ChatMessage[]): AsyncIterable<string>;
}

export async function* streamChatRuntime(
  adapter: ChatRuntimeAdapter,
  messages: ChatMessage[],
  tools: ToolDefinition[] = [],
): AsyncIterable<ChatStreamChunk> {
  const lastUserMessage = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";

  if (!tools.length) {
    yield* streamTextWithSuggestions(adapter.streamDirectText(messages), [], lastUserMessage);
    return;
  }

  const history: ChatMessage[] = [...messages];
  const forceToolOnFirstTurn = requiresDataTool(lastUserMessage);
  const toolResults: ExecutedToolResult[] = [];

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    const turnResult = await adapter.completeTurn({
      history,
      tools,
      turn,
      requireToolCall: turn === 0 && forceToolOnFirstTurn,
    });

    if (turnResult.type === "tool_calls" && turnResult.toolCalls?.length) {
      history.push({
        role: "assistant",
        content: turnResult.assistantContent ?? "",
        toolCalls: turnResult.toolCalls,
      });

      for (const toolCall of turnResult.toolCalls) {
        yield { toolCall: { name: toolCall.name, status: "calling" }, done: false };

        const { resultContent, parsedResult } = await executeTool(toolCall, tools);
        toolResults.push({ name: toolCall.name, result: parsedResult });

        yield { toolCall: { name: toolCall.name, status: "done" }, done: false };

        history.push({
          role: "tool",
          content: resultContent,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
        });
      }

      continue;
    }

    yield* streamTextWithSuggestions(adapter.streamFinalText(history), toolResults, lastUserMessage);
    return;
  }

  yield { text: "No pude completar la operación en el número máximo de pasos.", done: false };
  yield { done: true };
}

export function buildRuntimeMessages(input: {
  messages: ChatMessage[];
  systemContent: string;
  windowSize?: number;
}): ChatMessage[] {
  const { messages, systemContent, windowSize = 6 } = input;
  const conversation = messages.filter((m) => m.role !== "system");
  const windowed = conversation.slice(-windowSize);

  let windowStart = 0;
  while (windowStart < windowed.length && windowed[windowStart].role === "tool") {
    windowStart++;
  }

  return [{ role: "system", content: systemContent }, ...windowed.slice(windowStart)];
}

async function executeTool(
  toolCall: ToolCallRequest,
  tools: ToolDefinition[],
): Promise<{ resultContent: string; parsedResult: unknown }> {
  const tool = tools.find((item) => item.name === toolCall.name);
  if (!tool) {
    return {
      resultContent: JSON.stringify({ error: `Tool "${toolCall.name}" not found` }),
      parsedResult: null,
    };
  }

  try {
    const args = safeJsonParse(toolCall.arguments) as Record<string, unknown>;
    const parsedResult = await tool.execute(args);
    return {
      resultContent: JSON.stringify(parsedResult),
      parsedResult,
    };
  } catch (error) {
    return {
      resultContent: JSON.stringify({
        error: error instanceof Error ? error.message : "Execution error",
      }),
      parsedResult: null,
    };
  }
}

async function* streamTextWithSuggestions(
  textStream: AsyncIterable<string>,
  toolResults: ExecutedToolResult[],
  userMessage: string,
): AsyncIterable<ChatStreamChunk> {
  const deterministicText = buildDeterministicOperationalDateResponse({
    userMessage,
    toolResults,
  });
  const shouldSuppressFreeText = deterministicText !== null;
  let buffer = "";

  for await (const delta of textStream) {
    if (!delta) continue;

    buffer += delta;
    if (!shouldSuppressFreeText && buffer.indexOf("[SUGGESTIONS]") === -1 && buffer.length > 15) {
      yield { text: buffer.slice(0, -15), done: false };
      buffer = buffer.slice(-15);
    }
  }

  yield* flushBuffer(buffer, toolResults, userMessage, deterministicText);
}

async function* flushBuffer(
  buffer: string,
  toolResults: ExecutedToolResult[],
  userMessage: string,
  deterministicText?: string | null,
): AsyncIterable<ChatStreamChunk> {
  const emitSuggestions = (rawSuggestions: ChatSuggestion[]) => {
    const validated = validateSuggestions(rawSuggestions, toolResults);
    return buildDeterministicDateSuggestions({
      userMessage,
      toolResults,
      currentSuggestions: validated,
    });
  };
  const resolvedDeterministicText = deterministicText ?? buildDeterministicOperationalDateResponse({
    userMessage,
    toolResults,
  });

  const suggestionsStart = buffer.indexOf("[SUGGESTIONS]");

  if (suggestionsStart !== -1) {
    const textBefore = buffer.slice(0, suggestionsStart).trimEnd();
    const textToEmit = resolvedDeterministicText ?? textBefore;
    if (textToEmit) yield { text: textToEmit, done: false };

    const suggestionsMatch = buffer.match(/\[SUGGESTIONS\]([\s\S]*?)\[\/SUGGESTIONS\]/);
    if (suggestionsMatch) {
      try {
        const raw = JSON.parse(suggestionsMatch[1].trim());
        const suggestions = emitSuggestions(raw);
        yield { suggestions, done: true };
        return;
      } catch {
        const suggestions = emitSuggestions([]);
        if (suggestions.length > 0) {
          yield { suggestions, done: true };
          return;
        }
        yield { done: true };
        return;
      }
    }

    const suggestions = emitSuggestions([]);
    if (suggestions.length > 0) {
      yield { suggestions, done: true };
      return;
    }
    yield { done: true };
    return;
  }

  const trailingText = resolvedDeterministicText ?? buffer;
  if (trailingText) yield { text: trailingText, done: false };
  const suggestions = emitSuggestions([]);
  if (suggestions.length > 0) {
    yield { suggestions, done: true };
    return;
  }
  yield { done: true };
}

function safeJsonParse(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return {};
  }
}
