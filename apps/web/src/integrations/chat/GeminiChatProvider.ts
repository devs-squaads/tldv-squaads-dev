import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Content, FunctionDeclaration } from "@google/generative-ai";
import type { ChatMessage, ChatProvider, ChatStreamChunk } from "@/integrations/chat/ChatProvider";
import type { ToolDefinition, ToolCallRequest } from "@/integrations/chat/tools/types";
import {
  streamChatRuntime,
  type ChatRuntimeAdapter,
} from "@/modules/chat/application/chatRuntimeCore";

const MODEL = "gemini-3.1-flash-lite";

const TYPE_MAP: Record<string, string> = {
  string: "STRING",
  number: "NUMBER",
  boolean: "BOOLEAN",
  array: "ARRAY",
  object: "OBJECT",
};

function toGeminiType(type: string): string {
  return TYPE_MAP[type] ?? "STRING";
}

function toGeminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {
    type: toGeminiType(schema.type as string),
  };

  if (schema.description) result.description = schema.description;
  if (schema.enum) result.enum = schema.enum;

  if (schema.properties) {
    const props = schema.properties as Record<string, Record<string, unknown>>;
    result.properties = Object.fromEntries(
      Object.entries(props).map(([key, value]) => [key, toGeminiSchema(value)]),
    );
  }

  if (schema.required) result.required = schema.required;

  if (schema.items) {
    result.items = toGeminiSchema(schema.items as Record<string, unknown>);
  }

  return result;
}

function toGeminiFunctionDeclaration(tool: ToolDefinition): FunctionDeclaration {
  return {
    name: tool.name,
    description: tool.description,
    parameters: toGeminiSchema(
      tool.parameters as unknown as Record<string, unknown>,
    ) as unknown as FunctionDeclaration["parameters"],
  };
}

function toGeminiContent(message: ChatMessage): Content | null {
  if (message.role === "system") return null;

  if (message.role === "tool") {
    let parsedResponse: unknown;
    try {
      parsedResponse = JSON.parse(message.content);
    } catch {
      parsedResponse = { result: message.content };
    }

    return {
      role: "user",
      parts: [{
        functionResponse: {
          name: message.toolName ?? "unknown",
          response: parsedResponse as Record<string, unknown>,
        },
      }],
    };
  }

  if (message.role === "assistant" && message.toolCalls?.length) {
    return {
      role: "model",
      parts: message.toolCalls.map((toolCall) => {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(toolCall.arguments) as Record<string, unknown>;
        } catch {
          // noop
        }
        return { functionCall: { name: toolCall.name, args } };
      }),
    };
  }

  return {
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }],
  };
}

function getSystemInstruction(messages: ChatMessage[]): string | undefined {
  return messages.find((message) => message.role === "system")?.content;
}

function buildGeminiContents(messages: ChatMessage[]): Content[] {
  return messages.map(toGeminiContent).filter((content): content is Content => content !== null);
}

export class GeminiChatProvider implements ChatProvider {
  readonly name = "gemini";

  async *streamChat(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
  ): AsyncIterable<ChatStreamChunk> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY not configured");

    const genAI = new GoogleGenerativeAI(apiKey);

    const runtimeAdapter: ChatRuntimeAdapter = {
      completeTurn: async ({ history, tools: loopTools, requireToolCall, turn }) => {
        const model = genAI.getGenerativeModel({
          model: MODEL,
          tools: [{ functionDeclarations: loopTools.map(toGeminiFunctionDeclaration) }],
        });

        const contents = buildGeminiContents(history);
        const currentContent = contents.at(-1);
        if (!currentContent) return { type: "final" };

        const result = await model.generateContent({
          systemInstruction: getSystemInstruction(history),
          contents: [...contents.slice(0, -1), currentContent],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ...(requireToolCall ? ({ toolConfig: { functionCallingConfig: { mode: "ANY" } } } as any) : {}),
        });

        const functionCalls = result.response.functionCalls();
        if (functionCalls?.length) {
          const toolCalls: ToolCallRequest[] = functionCalls.map((functionCall, index) => ({
            id: `gemini-call-${turn}-${index}`,
            name: functionCall.name,
            arguments: JSON.stringify(functionCall.args ?? {}),
          }));

          return {
            type: "tool_calls",
            toolCalls,
            assistantContent: "",
          };
        }

        return { type: "final" };
      },

      streamFinalText: async function* (history) {
        const model = genAI.getGenerativeModel({ model: MODEL });
        const result = await model.generateContentStream({
          systemInstruction: getSystemInstruction(history),
          contents: buildGeminiContents(history),
        });

        for await (const chunk of result.stream) {
          const delta = chunk.text();
          if (delta) yield delta;
        }
      },

      streamDirectText: async function* (history) {
        const model = genAI.getGenerativeModel({ model: MODEL });
        const conversationMessages = history.filter((message) => message.role !== "system");

        const chat = model.startChat({
          systemInstruction: getSystemInstruction(history),
          history: conversationMessages.slice(0, -1).map((message) => ({
            role: message.role === "assistant" ? "model" : "user",
            parts: [{ text: message.content }],
          })),
        });

        const lastMessage = conversationMessages.at(-1);
        if (!lastMessage) return;

        const result = await chat.sendMessageStream(lastMessage.content);
        for await (const chunk of result.stream) {
          const delta = chunk.text();
          if (delta) yield delta;
        }
      },
    };

    yield* streamChatRuntime(runtimeAdapter, messages, tools ?? []);
  }
}
