"use client";

import { useState, useEffect } from "react";
import { Bot, X } from "lucide-react";
import { SquaadsLogo } from "@/components/SquaadsLogo";
import { ChatMessages } from "@/components/chat/ChatMessages";
import { ChatInput } from "@/components/chat/ChatInput";
import { ChatSuggestions } from "@/components/chat/ChatSuggestion";
import { useChatStream, getToolLabel } from "@/components/chat/useChatStream";
import { hasSupportTopicMarker } from "@/components/chat/chatWidget.logic";
import { ReportBugButton } from "@/components/bug-report/ReportBugButton";

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  // Manual escape hatch: covers a restored conversation whose history never
  // reached Soporte — reveals the button without losing history or needing the backend.
  const [manualReveal, setManualReveal] = useState(false);
  const { messages, suggestions, isLoading, error, activeToolCall, sendMessage, addQuickReply, reset } =
    useChatStream();
  const showBugReport = hasSupportTopicMarker(messages) || manualReveal;
  const normalizedError = error?.toLowerCase() ?? "";
  const isTokenError =
    /token|quota|rate limit|429|credit|crédito|l[ií]mite/.test(normalizedError);
  const isBackendError =
    /backend|provider|groq|gemini|openai|500|502|503|504|timeout|network|stream|fetch/.test(
      normalizedError
    );
  const showRobotError = Boolean(error) && (isTokenError || isBackendError);

  // Close panel on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  // Lock scroll on mobile when panel is open
  useEffect(() => {
    if (open && window.innerWidth < 640) {
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  function handleClose() {
    setOpen(false);
  }

  function handleOpen() {
    setOpen(true);
  }

  function handleSuggestionAction() {
    setOpen(false);
  }

  function handleReset() {
    setManualReveal(false);
    reset();
  }

  return (
    <>
      {/* Overlay — mobile only */}
      {open && (
        <div
          className="fixed inset-0 z-40 sm:hidden"
          style={{ background: "rgba(3,5,10,0.6)" }}
          onClick={handleClose}
          aria-hidden
        />
      )}

      {/* Side panel */}
      <div
        role="dialog"
        aria-label="Asistente Squaads"
        aria-modal="true"
        className="fixed right-0 top-0 z-50 flex h-full w-full flex-col sm:w-[400px] transition-transform duration-300 ease-in-out"
        style={{
          transform: open ? "translateX(0)" : "translateX(100%)",
          background: "var(--card)",
          backdropFilter: "blur(var(--glass-blur)) saturate(1.6)",
          WebkitBackdropFilter: "blur(var(--glass-blur)) saturate(1.6)",
          borderLeft: "1px solid var(--glass-border)",
          boxShadow: open ? "-8px 0 48px rgba(0,0,0,0.25)" : "none",
        }}
      >
        {/* Top accent line */}
        <div
          className="absolute inset-x-0 top-0 h-px"
          style={{
            background: "linear-gradient(to right, transparent, rgba(0,242,255,0.5), transparent)",
          }}
        />

        {/* Subtle radial glow in background */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(circle at top right, rgba(0,242,255,0.04), transparent 55%)",
          }}
        />

        {/* Header */}
        <div
          className="relative flex items-center gap-3 px-4 py-3.5 shrink-0"
          style={{ borderBottom: "1px solid var(--glass-border)" }}
        >
          <div
            className="flex h-9 w-9 items-center justify-center rounded-full"
            style={{
              background: "rgba(0,242,255,0.08)",
              border: "1px solid rgba(0,242,255,0.2)",
              boxShadow: "0 0 12px rgba(0,242,255,0.08)",
            }}
          >
            <Bot className="h-4 w-4 text-[#00F2FF]" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <SquaadsLogo size={14} />
              <span className="text-sm font-semibold truncate">Squaads Assistant</span>
            </div>
            <p className="text-[10px] text-[var(--muted-foreground)] flex items-center gap-1">
              {isLoading ? (
                <>
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full animate-pulse"
                    style={{ background: "#00F2FF" }}
                  />
                  {activeToolCall?.status === "calling"
                    ? getToolLabel(activeToolCall.name) + "..."
                    : "Procesando..."}
                </>
              ) : (
                <>
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ background: "#00F2FF" }}
                  />
                  En línea · listo para ayudarte
                </>
              )}
            </p>
          </div>

          <button
            type="button"
            onClick={handleClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[var(--accent)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            aria-label="Cerrar asistente"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Messages area */}
        <div className="relative flex flex-1 flex-col min-h-0">
          <ChatMessages messages={messages} onQuickReply={addQuickReply} />
        </div>

        {showBugReport && (
          <div className="flex justify-center pb-2">
            <ReportBugButton />
          </div>
        )}

        {/* Error banner */}
        {error && (
          showRobotError ? (
            <div
              className="mx-4 mb-2 rounded-xl px-3 py-2.5 text-xs flex items-start gap-2.5"
              style={{
                background: isTokenError ? "rgba(245,158,11,0.12)" : "rgba(239,68,68,0.12)",
                border: isTokenError
                  ? "1px solid rgba(245,158,11,0.26)"
                  : "1px solid rgba(239,68,68,0.24)",
              }}
            >
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full mt-0.5"
                style={{
                  background: "rgba(0,242,255,0.08)",
                  border: "1px solid rgba(0,242,255,0.3)",
                  animation: "robotAlert 1.7s ease-in-out infinite",
                }}
              >
                <Bot className="h-4 w-4 text-[#00F2FF]" />
              </span>
              <div className="min-w-0">
                <p
                  className="text-[11px] font-semibold"
                  style={{ color: isTokenError ? "#fde68a" : "#fca5a5" }}
                >
                  {isTokenError
                    ? "Límite de tokens alcanzado"
                    : "Backend temporalmente inestable"}
                </p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--foreground)]">{error}</p>
              </div>
            </div>
          ) : (
            <div
              className="mx-4 mb-2 rounded-xl px-3 py-2 text-xs"
              style={{
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.2)",
                color: "#fca5a5",
              }}
            >
              {error}
            </div>
          )
        )}

        {/* Suggestions */}
        <ChatSuggestions
          suggestions={suggestions}
          onAction={handleSuggestionAction}
        />

        {/* Input */}
        <div className="shrink-0">
          <ChatInput onSend={sendMessage} disabled={isLoading} />
        </div>

        {/* Reset conversation + manual report-a-problem escape hatch */}
        {messages.length > 0 && !isLoading && (
          <div
            className="flex justify-center items-center gap-3 pb-2"
            style={{ borderTop: "1px solid var(--glass-border)" }}
          >
            <button
              type="button"
              onClick={handleReset}
              className="py-1.5 text-[10px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
            >
              Nueva conversación
            </button>
            {!showBugReport && (
              <button
                type="button"
                onClick={() => setManualReveal(true)}
                className="py-1.5 text-[10px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
              >
                ¿Necesitás reportar un problema?
              </button>
            )}
          </div>
        )}
      </div>

      {/* Floating trigger button */}
      <button
        type="button"
        onClick={handleOpen}
        aria-label="Abrir asistente Squaads"
        className="fixed bottom-6 right-6 z-50 flex h-[52px] w-[52px] items-center justify-center rounded-full transition-all duration-300 active:scale-95"
        style={{
          background: "var(--card)",
          backdropFilter: "blur(16px) saturate(1.6)",
          WebkitBackdropFilter: "blur(16px) saturate(1.6)",
          border: "1px solid rgba(0,242,255,0.3)",
          boxShadow: open
            ? "none"
            : "0 0 0 0 rgba(0,242,255,0.4), 0 4px 20px rgba(0,0,0,0.2)",
          opacity: open ? 0 : 1,
          pointerEvents: open ? "none" : "auto",
          animation: open ? "none" : "chatPulse 2.5s ease-in-out infinite",
        }}
      >
        <Bot className="h-6 w-6 text-[#00F2FF]" />
      </button>

      {/* Pulse animation */}
      <style>{`
        @keyframes chatPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(0,242,255,0.35), 0 4px 20px rgba(0,0,0,0.2); }
          50% { box-shadow: 0 0 0 8px rgba(0,242,255,0), 0 4px 20px rgba(0,0,0,0.2); }
        }
        @keyframes typingDot {
          0%, 60%, 100% { opacity: 0.25; transform: translateY(0); }
          30% { opacity: 1; transform: translateY(-3px); }
        }
        @keyframes robotAlert {
          0%, 100% { transform: translateY(0) rotate(0deg); box-shadow: 0 0 0 0 rgba(0,242,255,0.22); }
          35% { transform: translateY(-1px) rotate(-6deg); }
          65% { transform: translateY(1px) rotate(6deg); box-shadow: 0 0 0 6px rgba(0,242,255,0); }
        }
      `}</style>
    </>
  );
}
