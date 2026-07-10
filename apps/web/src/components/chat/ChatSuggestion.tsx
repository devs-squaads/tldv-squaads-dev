"use client";

import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import type { ChatSuggestion } from "@/integrations/chat/ChatProvider";
import { openExtensionInstallModal } from "@/modules/extension-install/modalBridge";

interface ChatSuggestionsProps {
  suggestions: ChatSuggestion[];
  onAction?: () => void;
}

function resolveRoute(suggestion: ChatSuggestion): string {
  const p = suggestion.payload ?? {};
  switch (suggestion.action) {
    case "view_meetings": {
      const params = new URLSearchParams();
      if (p.filter) params.set("filter", p.filter);
      if (p.date) params.set("date", p.date);
      const qs = params.toString();
      return qs ? `/?${qs}` : "/";
    }
    case "view_meeting_detail":
    case "view_transcription":
      return p.id ? `/meeting/${p.id}` : "/";
    case "open_settings":
      return "/settings";
    default:
      return "/";
  }
}

export function ChatSuggestions({ suggestions, onAction }: ChatSuggestionsProps) {
  const router = useRouter();

  if (suggestions.length === 0) return null;

  function handleClick(suggestion: ChatSuggestion) {
    if (suggestion.action === "install_extension") {
      openExtensionInstallModal();
      onAction?.();
      return;
    }

    router.push(resolveRoute(suggestion));
    onAction?.();
  }

  return (
    <div
      className="flex flex-wrap gap-2 px-4 pb-3"
      style={{ borderTop: "1px solid var(--glass-border)", paddingTop: "10px" }}
    >
      <p className="w-full text-[10px] uppercase tracking-wider text-[var(--muted-foreground)] mb-1">
        Acciones sugeridas
      </p>
      {suggestions.map((s, i) => (
        <button
          key={i}
          type="button"
          onClick={() => handleClick(s)}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all active:scale-95 hover:brightness-110"
          style={{
            background: "rgba(0,242,255,0.08)",
            border: "1px solid rgba(0,242,255,0.25)",
            color: "#00F2FF",
          }}
        >
          {s.label}
          <ArrowRight className="h-3 w-3" />
        </button>
      ))}
    </div>
  );
}
