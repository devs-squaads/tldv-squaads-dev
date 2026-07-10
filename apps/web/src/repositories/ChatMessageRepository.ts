import { db } from "@meeting-bot/shared/db";
import { chatMessages } from "@meeting-bot/shared/db/schema";
import { eq, asc } from "drizzle-orm";
import {
  ALLOWED_PERSISTED_ROLES,
  MAX_MESSAGES,
  type PersistableChatMessage,
} from "@/modules/chat/http/contracts";
import {
  ChatTrustBoundaryError,
  enforceTotalContentLimit,
  isRecord,
  normalizeText,
} from "@/modules/chat/http/trustBoundary";

export type ChatMessageRecord = PersistableChatMessage;

function normalizePersistedRole(value: unknown): ChatMessageRecord["role"] | null {
  if (typeof value !== "string") return null;

  return ALLOWED_PERSISTED_ROLES.includes(value as ChatMessageRecord["role"])
    ? (value as ChatMessageRecord["role"])
    : null;
}

function normalizePersistedRecord(value: unknown): ChatMessageRecord | null {
  if (!isRecord(value)) return null;

  const role = normalizePersistedRole(value.role);
  const content = normalizeText(value.content);

  if (!role || !content) return null;

  return { role, content };
}

function normalizeRecordsForRead(rows: Array<{ role: string; content: string }>): ChatMessageRecord[] {
  const normalized: ChatMessageRecord[] = [];

  for (const row of rows) {
    const record = normalizePersistedRecord(row);
    if (record) normalized.push(record);
  }

  return enforceTotalContentLimit(normalized.slice(-MAX_MESSAGES), "truncate");
}

function normalizeRecordsForWrite(messages: ChatMessageRecord[]): ChatMessageRecord[] {
  if (!Array.isArray(messages)) {
    throw new ChatTrustBoundaryError("messages array is required");
  }

  const normalized = messages.map((message) => {
    const record = normalizePersistedRecord(message);
    if (!record) {
      throw new ChatTrustBoundaryError("Invalid message role or content");
    }

    return record;
  });

  return enforceTotalContentLimit(normalized.slice(-MAX_MESSAGES), "truncate");
}

export class ChatMessageRepository {
  /** Devuelve los últimos MAX_MESSAGES mensajes del usuario en orden cronológico. */
  static async findByUserId(userId: string): Promise<ChatMessageRecord[]> {
    const rows = await db
      .select({ role: chatMessages.role, content: chatMessages.content })
      .from(chatMessages)
      .where(eq(chatMessages.userId, userId))
      .orderBy(asc(chatMessages.createdAt), asc(chatMessages.id));

    return normalizeRecordsForRead(rows);
  }

  /** Reemplaza TODO el historial del usuario con los mensajes recibidos (máx MAX_MESSAGES). */
  static async replaceForUser(
    userId: string,
    messages: ChatMessageRecord[],
  ): Promise<void> {
    const toSave = normalizeRecordsForWrite(messages);

    await db.transaction(async (tx) => {
      await tx.delete(chatMessages).where(eq(chatMessages.userId, userId));

      if (toSave.length === 0) return;

      const now = Date.now();
      await tx.insert(chatMessages).values(
        toSave.map((message, index) => ({
          id: crypto.randomUUID(),
          userId,
          role: message.role,
          content: message.content,
          createdAt: new Date(now + index), // garantiza orden cronológico
        })),
      );
    });
  }

  /** Elimina todo el historial del usuario. */
  static async deleteByUserId(userId: string): Promise<void> {
    await db.delete(chatMessages).where(eq(chatMessages.userId, userId));
  }
}
