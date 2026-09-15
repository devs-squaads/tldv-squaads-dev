"use client";

import { useState, useRef } from "react";
import { Send, Mic, MicOff } from "lucide-react";

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  /** La feature de voz está encendida (VOICE_CHAT_ENABLED). */
  voiceEnabled?: boolean;
  /** Hay una sesión de voz en curso. */
  voiceActive?: boolean;
  /** El usuario está grabando su turno (push-to-talk). */
  voiceRecording?: boolean;
  /** Se está pidiendo token / conectando / reconectando. */
  voiceBusy?: boolean;
  onToggleVoice?: () => void;
}

export function ChatInput({
  onSend,
  disabled,
  voiceEnabled,
  voiceActive,
  voiceRecording,
  voiceBusy,
  onToggleVoice,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleSubmit() {
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
    setValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setValue(e.target.value);
    // Auto-resize
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    }
  }

  return (
    <div
      className="flex items-end gap-2 px-3 py-3"
      style={{ borderTop: "1px solid var(--glass-border)" }}
    >
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleInput}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={voiceActive ? "Escuchando... podés hablar o escribir" : "Escribí tu consulta..."}
        rows={1}
        className="flex-1 resize-none rounded-xl px-3 py-2 text-sm leading-relaxed placeholder:text-[var(--muted-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00F2FF]/50 disabled:opacity-50 transition-all"
        style={{
          background: "var(--card)",
          backdropFilter: "blur(12px) saturate(1.4)",
          WebkitBackdropFilter: "blur(12px) saturate(1.4)",
          border: "1px solid var(--glass-border)",
          color: "var(--foreground)",
          maxHeight: "120px",
          overflowY: "auto",
        }}
      />
      {voiceEnabled && (
        <button
          type="button"
          onClick={onToggleVoice}
          disabled={voiceBusy}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-all disabled:opacity-50 active:scale-95"
          style={{
            background: voiceRecording
              ? "#ef4444"
              : voiceActive
                ? "rgba(0,242,255,0.14)"
                : "var(--secondary)",
            color: voiceRecording
              ? "#fff"
              : voiceActive
                ? "#00F2FF"
                : "var(--muted-foreground)",
            border: voiceRecording
              ? "1px solid rgba(239,68,68,0.5)"
              : voiceActive
                ? "1px solid rgba(0,242,255,0.4)"
                : "1px solid var(--glass-border)",
            boxShadow: voiceRecording
              ? "0 0 12px rgba(239,68,68,0.45)"
              : voiceActive
                ? "0 0 12px rgba(0,242,255,0.18)"
                : "none",
          }}
          aria-label={
            voiceRecording
              ? "Terminar el turno de voz"
              : voiceActive
                ? "Empezar a hablar"
                : "Hablar con el asistente"
          }
          aria-pressed={Boolean(voiceActive)}
          title={
            voiceRecording
              ? "Terminar el turno de voz"
              : voiceActive
                ? "Empezar a hablar"
                : "Hablar con el asistente"
          }
        >
          {voiceRecording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </button>
      )}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={disabled || !value.trim()}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-all disabled:opacity-40 active:scale-95"
        style={{
          background: value.trim() && !disabled ? "#00F2FF" : "var(--secondary)",
          color: value.trim() && !disabled ? "#000" : "var(--muted-foreground)",
          border: "1px solid var(--glass-border)",
        }}
        aria-label="Enviar mensaje"
      >
        <Send className="h-4 w-4" />
      </button>
    </div>
  );
}
