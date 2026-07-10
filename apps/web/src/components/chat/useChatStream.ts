"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useSession } from "next-auth/react";
import type { ChatMessage, ChatSuggestion } from "@/integrations/chat/ChatProvider";

// ─── Persistencia: DB como fuente de verdad, localStorage como caché ──────────

const STORAGE_KEY_PREFIX = "squaads_chat_history";
const LEGACY_STORAGE_KEY = STORAGE_KEY_PREFIX;
const MAX_STORED_MESSAGES = 30;

function getStorageKey(userId: string | null | undefined): string | null {
  if (!userId) return null;
  return `${STORAGE_KEY_PREFIX}:${userId}`;
}

function readLocalCache(storageKey: string | null): DisplayMessage[] {
  if (!storageKey) return [];
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DisplayMessage[];
    return Array.isArray(parsed) ? parsed.map((m) => ({ ...m, isStreaming: false })) : [];
  } catch {
    return [];
  }
}

function writeLocalCache(storageKey: string | null, messages: DisplayMessage[]) {
  if (!storageKey) return;
  if (typeof window === "undefined") return;
  try {
    const toSave = messages
      .filter((m) => !m.isStreaming && m.content.trim())
      .slice(-MAX_STORED_MESSAGES);
    localStorage.setItem(storageKey, JSON.stringify(toSave));
  } catch {
    // localStorage lleno — no bloquear
  }
}

function clearLocalCache(storageKey: string | null) {
  if (typeof window === "undefined" || !storageKey) return;
  localStorage.removeItem(storageKey);
}

async function fetchHistoryFromDB(): Promise<DisplayMessage[]> {
  try {
    const res = await fetch("/api/chat/history");
    if (!res.ok) return [];
    const data = await res.json() as { messages: Array<{ role: string; content: string }> };
    return data.messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  } catch {
    return [];
  }
}

async function saveHistoryToDB(messages: DisplayMessage[]) {
  try {
    const toSave = messages
      .filter((m) => !m.isStreaming && m.content.trim())
      .slice(-MAX_STORED_MESSAGES)
      .map((m) => ({ role: m.role, content: m.content }));

    await fetch("/api/chat/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: toSave }),
    });
  } catch {
    // silencioso — la caché local sigue siendo válida
  }
}

async function clearHistoryInDB() {
  try {
    await fetch("/api/chat/history", { method: "DELETE" });
  } catch {
    // silencioso
  }
}

export interface DisplayMessage {
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
}

export interface ActiveToolCall {
  name: string;
  status: "calling" | "done";
}

/** Nombre de tool → label legible para mostrar al usuario */
const TOOL_LABELS: Record<string, string> = {
  search_meetings: "buscando reuniones",
  get_meeting_detail: "leyendo reunión",
  get_system_status: "verificando sistema",
  enqueue_meeting: "encolando reunión",
  manage_meeting_share: "gestionando accesos",
};

export function getToolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name.replace(/_/g, " ");
}

export function useChatStream() {
  const { data: session, status: sessionStatus } = useSession();
  const userId = session?.user?.id ?? null;
  const storageKey = getStorageKey(userId);

  // Arrancar vacío en SSR y cliente — evita hydration mismatch
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [suggestions, setSuggestions] = useState<ChatSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeToolCall, setActiveToolCall] = useState<ActiveToolCall | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pendingSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Al montar (solo cliente): cargar caché local inmediatamente, luego sincronizar con DB
  useEffect(() => {
    if (sessionStatus === "loading") return;

    if (typeof window !== "undefined") {
      // Limpia la key legacy global para evitar fugas entre usuarios.
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    }

    setMessages([]);

    if (!userId) return;

    const cached = readLocalCache(storageKey);
    if (cached.length > 0) setMessages(cached);

    fetchHistoryFromDB().then((dbMessages) => {
      if (dbMessages.length > 0) {
        setMessages(dbMessages);
        writeLocalCache(storageKey, dbMessages);
      }
    });
  }, [sessionStatus, storageKey, userId]);

  // Persistir con debounce (500ms) tras cada cambio de mensajes
  useEffect(() => {
    if (sessionStatus === "loading" || !userId) return;

    if (pendingSaveRef.current) clearTimeout(pendingSaveRef.current);
    pendingSaveRef.current = setTimeout(() => {
      writeLocalCache(storageKey, messages);
      saveHistoryToDB(messages);
    }, 500);

    return () => {
      if (pendingSaveRef.current) clearTimeout(pendingSaveRef.current);
    };
  }, [messages, sessionStatus, storageKey, userId]);

  const sendMessage = useCallback(async (userText: string) => {
    if (!userText.trim() || isLoading) return;
    if (!userId) {
      setError("Sesión no disponible. Iniciá sesión para usar el chat.");
      return;
    }

    setError(null);
    setSuggestions([]);
    setActiveToolCall(null);

    const userMessage: DisplayMessage = { role: "user", content: userText.trim() };

    setMessages((prev) => [
      ...prev,
      userMessage,
      { role: "assistant", content: "", isStreaming: true },
    ]);

    setIsLoading(true);

    const historyForApi: ChatMessage[] = [
      ...messages.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: userText.trim() },
    ];

    abortRef.current = new AbortController();

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: historyForApi }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Error ${res.status}`);
      }

      if (!res.body) throw new Error("No stream body received");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;

          let chunk: {
            text?: string;
            suggestions?: ChatSuggestion[];
            toolCall?: { name: string; status: "calling" | "done" };
            done?: boolean;
            error?: string;
          };
          try {
            chunk = JSON.parse(jsonStr);
          } catch {
            continue;
          }

          if (chunk.error) {
            setError(chunk.error);
            break;
          }

          // Feedback de tool call en progreso
          if (chunk.toolCall) {
            setActiveToolCall(chunk.toolCall);
            // Limpiar cuando termina
            if (chunk.toolCall.status === "done") {
              setActiveToolCall(null);
            }
          }

          if (chunk.text) {
            setMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last?.role === "assistant") {
                updated[updated.length - 1] = {
                  ...last,
                  content: last.content + chunk.text,
                  isStreaming: true,
                };
              }
              return updated;
            });
          }

          if (chunk.suggestions) {
            setSuggestions(chunk.suggestions);
          }

          if (chunk.done) {
            setActiveToolCall(null);
            setMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last?.role === "assistant") {
                updated[updated.length - 1] = { ...last, isStreaming: false };
              }
              return updated;
            });
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      const message = err instanceof Error ? err.message : "Error al conectar con el asistente";
      setError(message);
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === "assistant") {
          updated[updated.length - 1] = { ...last, isStreaming: false };
        }
        return updated;
      });
    } finally {
      setIsLoading(false);
      setActiveToolCall(null);
    }
  }, [isLoading, messages, userId]);

  const clearSuggestions = useCallback(() => setSuggestions([]), []);

  /** Injects a user + assistant exchange directly — no API call, instant response. */
  const addQuickReply = useCallback((question: string, answer: string) => {
    setSuggestions([]);
    setError(null);
    setMessages((prev) => [
      ...prev,
      { role: "user", content: question },
      { role: "assistant", content: answer, isStreaming: false },
    ]);
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setSuggestions([]);
    setError(null);
    setIsLoading(false);
    setActiveToolCall(null);
    clearLocalCache(storageKey);
    if (userId) {
      clearHistoryInDB();
    }
  }, [storageKey, userId]);

  return {
    messages,
    suggestions,
    isLoading,
    error,
    activeToolCall,
    sendMessage,
    addQuickReply,
    clearSuggestions,
    reset,
  };
}
