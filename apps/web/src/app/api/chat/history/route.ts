import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import {
  createChatRequestContext,
  jsonWithChatRequestContext,
} from "@/modules/chat/http/requestContext";
import {
  ChatTrustBoundaryError,
  sanitizeMessageList,
  sanitizePersistedHistory,
} from "@/modules/chat/http/trustBoundary";
import { ChatMessageRepository } from "@/repositories/ChatMessageRepository";
import type { PersistableChatMessage } from "@/modules/chat/http/contracts";

export const dynamic = "force-dynamic";

/** GET /api/chat/history — carga el historial del usuario autenticado */
export async function GET(req: NextRequest) {
  const requestContext = createChatRequestContext(req, "chatHistory");
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return jsonWithChatRequestContext(requestContext, { error: "Unauthorized" }, { status: 401 });
  }

  const persistedMessages = await ChatMessageRepository.findByUserId(session.user.id);
  const messages = sanitizePersistedHistory(persistedMessages);
  return jsonWithChatRequestContext(requestContext, { messages });
}

/** POST /api/chat/history — reemplaza el historial completo */
export async function POST(req: NextRequest) {
  const requestContext = createChatRequestContext(req, "chatHistory");
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return jsonWithChatRequestContext(requestContext, { error: "Unauthorized" }, { status: 401 });
  }

  let messages: PersistableChatMessage[];
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
    return jsonWithChatRequestContext(requestContext, { error: message }, { status: 400 });
  }

  await ChatMessageRepository.replaceForUser(session.user.id, messages);
  return jsonWithChatRequestContext(requestContext, { ok: true });
}

/** DELETE /api/chat/history — elimina todo el historial */
export async function DELETE(req: NextRequest) {
  const requestContext = createChatRequestContext(req, "chatHistory");
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return jsonWithChatRequestContext(requestContext, { error: "Unauthorized" }, { status: 401 });
  }

  await ChatMessageRepository.deleteByUserId(session.user.id);
  return jsonWithChatRequestContext(requestContext, { ok: true });
}
