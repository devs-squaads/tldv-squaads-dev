import { WebMeetingRepository } from "@/repositories/WebMeetingRepository";
import { WebSettingsRepository } from "@/repositories/WebSettingsRepository";
import type { AuthorizedAccountRole } from "@meeting-bot/shared/repositories/AuthorizedAccountRepository";

// ─── Context builder ───────────────────────────────────────────────────────

const ROLE_DESCRIPTIONS: Record<AuthorizedAccountRole, string> = {
  admin: "Rol del usuario: admin (puede gestionar el equipo y autorizar cuentas)",
  member: "Rol del usuario: member (solo lectura de la gestión del equipo)",
};

/**
 * Lightweight context: totals + configuration + today's date.
 * Never injects meeting lists — those are fetched on-demand via search_meetings tool.
 */
export async function buildUserContext(
  input: { userId: string; role?: AuthorizedAccountRole },
): Promise<string> {
  const today = new Date().toLocaleDateString("es-AR", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  // Computed outside the try — the role comes from the caller's session, not
  // from I/O, so it must survive the fallback branch below.
  const roleLine = input.role ? ROLE_DESCRIPTIONS[input.role] : "";

  try {
    const [meetings, settings] = await Promise.all([
      WebMeetingRepository.listRecent(input.userId),
      WebSettingsRepository.toRecord(),
    ]);

    const errorCount = meetings.filter((m) => m.status === "error").length;
    const pendingCount = meetings.filter((m) =>
      ["pending", "joining", "waiting_admission", "recording", "transcribing", "summarizing"].includes(m.status)
    ).length;

    const autoJoinActive = settings["calendar_auto_join_enabled"] === "true";
    const transcriptionProvider = settings["transcription_provider"] || "groq (default)";
    const summaryProvider = settings["summary_provider"] || "gemini (default)";
    const groqConfigured = Boolean(settings["groq_api_key"] || process.env.GROQ_API_KEY);
    const geminiConfigured = Boolean(settings["gemini_api_key"] || process.env.GEMINI_API_KEY);

    return `
═══════════════════════════════════════
CONTEXTO DEL SISTEMA
═══════════════════════════════════════
Fecha actual: ${today}${roleLine ? `\n${roleLine}` : ""}
Reuniones: ${meetings.length} totales · ${pendingCount} en proceso · ${errorCount} con error${errorCount > 0 ? " ← requieren atención" : ""}
Auto-join: ${autoJoinActive ? "ACTIVADO" : "DESACTIVADO"} · Transcripción: ${transcriptionProvider} · Resumen: ${summaryProvider}
Groq: ${groqConfigured ? "✓" : "NO ← posible causa de errores"} · Gemini: ${geminiConfigured ? "✓" : "NO ← posible causa de errores"}
═══════════════════════════════════════`.trim();
  } catch {
    return `
═══════════════════════════════════════
CONTEXTO DEL SISTEMA
═══════════════════════════════════════
Fecha actual: ${today}${roleLine ? `\n${roleLine}` : ""}
(No se pudo cargar el contexto del usuario)
═══════════════════════════════════════`.trim();
  }
}
