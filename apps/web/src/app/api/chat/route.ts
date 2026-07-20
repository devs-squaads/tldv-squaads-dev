import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { ChatProviderFactory } from "@/integrations/chat/ChatProviderFactory";
import { assembleChatSystemPrompt } from "@/integrations/chat/knowledge/promptAssembler";
import { buildUserContext } from "@/integrations/chat/knowledge/userContext";
import { ALL_TOOLS, READ_ONLY_TOOLS } from "@/integrations/chat/tools";
import { requiresDataTool } from "@/integrations/chat/tools/suggestionValidator";
import type { ChatMessage } from "@/integrations/chat/ChatProvider";
import { buildRuntimeMessages } from "@/modules/chat/application/chatRuntimeCore";
import type { ClientChatMessage } from "@/modules/chat/http/contracts";
import {
  createChatRequestContext,
  jsonWithChatRequestContext,
  withChatRequestHeaders,
} from "@/modules/chat/http/requestContext";
import {
  ChatTrustBoundaryError,
  buildTrustedConversation,
  sanitizeMessageList,
} from "@/modules/chat/http/trustBoundary";
import { resolveChatToolPolicy } from "@/modules/chat/policy/toolPolicy";
import { ChatMessageRepository } from "@/repositories/ChatMessageRepository";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const requestContext = createChatRequestContext(req, "chat");
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return jsonWithChatRequestContext(requestContext, { error: "Unauthorized" }, {
      status: 401,
    });
  }

  let messages: ClientChatMessage[];
  try {
    const body = await req.json();
    messages = sanitizeMessageList(
      typeof body === "object" && body !== null && "messages" in body
        ? (body as { messages?: unknown }).messages
        : null,
    );
  } catch (error) {
    const message = error instanceof ChatTrustBoundaryError
      ? error.message
      : error instanceof Error
        ? error.message
        : "Invalid JSON body";
    return jsonWithChatRequestContext(requestContext, { error: message }, {
      status: 400,
    });
  }

  if (messages.length === 0) {
    return jsonWithChatRequestContext(requestContext, { error: "At least one valid message is required" }, {
      status: 400,
    });
  }

  const providerResolution = ChatProviderFactory.resolveProviderResolution();

  if (!providerResolution.effectiveProvider) {
    const errorMessage = providerResolution.resolutionSource === "invalid-configured"
      ? `Unsupported chat provider \"${providerResolution.configuredProvider}\"`
      : "No AI provider configured";

    return jsonWithChatRequestContext(requestContext, { error: errorMessage }, {
      status: 503,
    });
  }

  const persistedHistory = await ChatMessageRepository.findByUserId(session.user.id);
  const trustedConversation = buildTrustedConversation({
    persistedHistory,
    clientMessages: messages,
  });
  const userContext = await buildUserContext({ userId: session.user.id, role: session.user.role });
  const promptAssembly = assembleChatSystemPrompt({
    messages: trustedConversation.messages,
    userContext,
    topK: 4,
  });

  const fullMessages: ChatMessage[] = buildRuntimeMessages({
    messages: trustedConversation.messages,
    systemContent: promptAssembly.systemContent,
    windowSize: 6,
  });

  const toolPolicy = resolveChatToolPolicy();
  const tools = toolPolicy.activePolicy === "full" ? ALL_TOOLS : READ_ONLY_TOOLS;
  const latestUserMessage = [...trustedConversation.messages].reverse().find((message) => message.role === "user")?.content ?? "";
  const fallbackTools = requiresDataTool(latestUserMessage) ? READ_ONLY_TOOLS : [];

  const provider = ChatProviderFactory.getProviderWithFallback();
  const fallbackProvider = ChatProviderFactory.getFallbackProvider();

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        for await (const chunk of provider.streamChat(fullMessages, tools)) {
          send(chunk);
          if (chunk.done) break;
        }
      } catch (primaryErr) {
        // Primary provider failed mid-stream (e.g. 429, quota exceeded).
        // Attempt fallback provider before surfacing the error to the user.
        // NOTE: for operational queries fallback keeps read-only tools enabled so
        // answers remain grounded in real data. For documental/general prompts,
        // fallback still runs sin tools to preserve token budget.
        if (fallbackProvider) {
          try {
            for await (const chunk of fallbackProvider.streamChat(fullMessages, fallbackTools)) {
              send(chunk);
              if (chunk.done) break;
            }
          } catch (fallbackErr) {
            const message = fallbackErr instanceof Error ? fallbackErr.message : "Stream error";
            send({ error: message, done: true });
          }
        } else {
          const message = primaryErr instanceof Error ? primaryErr.message : "Stream error";
          send({ error: message, done: true });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: withChatRequestHeaders(requestContext, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    }),
  });
}
