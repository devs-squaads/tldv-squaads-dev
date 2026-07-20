/**
 * Tool Definitions — las 5 herramientas del Squaads Assistant.
 *
 * Cada una implementa ToolDefinition<TArgs, TResult> y usa los
 * repositorios existentes directamente. No hay lógica nueva de negocio aquí.
 */

import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { WebMeetingRepository, type MeetingFilters } from "@/repositories/WebMeetingRepository";
import { WebSettingsRepository } from "@/repositories/WebSettingsRepository";
import { MeetingShareRepository } from "@/repositories/MeetingShareRepository";
import { MeetingShareService } from "@/services/meetingShareService";
import { ChatProviderFactory } from "@/integrations/chat/ChatProviderFactory";
import { resolveChatToolPolicy } from "@/modules/chat/policy/toolPolicy";
import { MeetingRepository } from "@meeting-bot/shared/repositories/MeetingRepository";
import { getMeetingStatusLabel } from "@meeting-bot/shared/domain/meetingStatus";
import type { MeetingStatus } from "@meeting-bot/shared/domain/meetingStatus";
import type { SummaryResult } from "@meeting-bot/shared/integrations/ai/summary/types";
import type {
  ToolDefinition,
  MeetingSummaryForLLM,
  MeetingDetailForLLM,
  SystemStatusForLLM,
  EnqueueMeetingResultForLLM,
  ManageShareResultForLLM,
} from "./types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toMeetingSummary(m: Awaited<ReturnType<typeof WebMeetingRepository.listRecent>>[number]): MeetingSummaryForLLM {
  return {
    id: m.id,
    name: m.name,
    url: m.url,
    status: m.status,
    statusLabel: getMeetingStatusLabel(m.status as MeetingStatus),
    errorMessage: m.errorMessage,
    hasTranscription: Boolean(m.rawTranscription),
    hasSummary: Boolean(m.summary),
    startsAt: m.startsAt?.toISOString() ?? null,
    createdAt: m.createdAt.toISOString(),
    durationMinutes: m.durationMinutes,
  };
}

function parseSummary(raw: string | null): MeetingDetailForLLM["summaryData"] {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SummaryResult;
    return {
      summary: parsed.summary,
      actionItems: parsed.actionItems ?? [],
      keyMoments: (parsed.keyMoments ?? []).map((km) => ({
        timeSeconds: km.timeSeconds,
        title: km.title,
        description: km.description,
      })),
    };
  } catch {
    // summary guardado como texto plano (formato legacy)
    return { summary: raw, actionItems: [], keyMoments: [] };
  }
}

// ─── 1. search_meetings ───────────────────────────────────────────────────────

export interface SearchMeetingsArgs {
  status?: string;
  from_date?: string;
  to_date?: string;
  query?: string;
  limit?: number;
}

export const searchMeetingsTool: ToolDefinition<SearchMeetingsArgs, MeetingSummaryForLLM[]> = {
  name: "search_meetings",
  description:
    "Busca y filtra reuniones por fecha, estado o texto. " +
    "Usala para cualquier consulta que involucre fechas ('el 24/03', 'ayer', 'la semana pasada', 'el último mes'), " +
    "estados ('las que fallaron', 'las pendientes') o nombres. " +
    "Convierte fechas relativas a ISO 8601 usando la fecha actual del contexto del sistema. " +
    "Retorna lista resumida sin transcripciones.",
  parameters: {
    type: "object",
    properties: {
      status: {
        type: "string",
        description: "Filtrar por estado de la reunión",
        enum: [
          "pending",
          "joining",
          "waiting_admission",
          "recording",
          "transcribing",
          "summarizing",
          "completed",
          "error",
          "rejected",
          "admission_timeout",
        ],
      },
      from_date: {
        type: "string",
        description: "Fecha mínima de creación en formato ISO 8601 (ej: 2026-04-01T00:00:00Z)",
      },
      to_date: {
        type: "string",
        description: "Fecha máxima de creación en formato ISO 8601 (ej: 2026-04-13T23:59:59Z)",
      },
      query: {
        type: "string",
        description: "Texto libre para buscar en el nombre o URL de la reunión (case-insensitive)",
      },
      limit: {
        type: "number",
        description: "Máximo de resultados a retornar. Default: 10, máximo: 50.",
      },
    },
  },
  async execute({ status, from_date, to_date, query, limit = 10 }) {
    const filters: MeetingFilters = { status, from_date, to_date, query, limit };
    const results = await WebMeetingRepository.listFiltered(filters);
    return results.map(toMeetingSummary);
  },
};

// ─── 2. get_meeting_detail ────────────────────────────────────────────────────

export interface GetMeetingDetailArgs {
  meeting_id: string;
  include_transcription?: boolean;
}

export const getMeetingDetailTool: ToolDefinition<GetMeetingDetailArgs, MeetingDetailForLLM | null> = {
  name: "get_meeting_detail",
  description:
    "Obtiene el detalle completo de una reunión específica: estado, resumen estructurado " +
    "(con action items y key moments), y opcionalmente la transcripción raw. " +
    "Úsala cuando el usuario pregunte por el contenido, error o resultado de UNA reunión. " +
    "Ponés include_transcription: true cuando el usuario pida VER, LEER o REVISAR la transcripción " +
    "de esa reunión. No incluyas la transcripción a menos que el usuario la pida explícitamente " +
    "(es larga y consume mucho contexto).",
  parameters: {
    type: "object",
    properties: {
      meeting_id: {
        type: "string",
        description: "ID único de la reunión",
      },
      include_transcription: {
        type: "boolean",
        description:
          "Si se debe incluir la transcripción raw completa. Default: false. " +
          "Solo ponlo en true si el usuario pregunta explícitamente por la transcripción.",
      },
    },
    required: ["meeting_id"],
  },
  async execute({ meeting_id, include_transcription = false }) {
    const meeting = await MeetingRepository.findById(meeting_id);
    if (!meeting) return null;

    const shares = await MeetingShareRepository.listByMeetingId(meeting_id);
    const now = new Date();
    const activeSharesCount = shares.filter(
      (s) => !s.revokedAt && (!s.expiresAt || s.expiresAt > now)
    ).length;

    return {
      ...toMeetingSummary(meeting),
      summaryData: parseSummary(meeting.summary),
      transcription: include_transcription ? (meeting.rawTranscription ?? null) : null,
      activeSharesCount,
    };
  },
};

// ─── 3. get_system_status ─────────────────────────────────────────────────────

export const getSystemStatusTool: ToolDefinition<Record<never, never>, SystemStatusForLLM> = {
  name: "get_system_status",
  description:
    "Retorna el estado actual del sistema: qué providers están configurados, si el auto-join " +
    "de Google Calendar está activo, y un diagnóstico de posibles problemas. " +
    "Úsala cuando el usuario pregunte por errores de configuración, API keys, " +
    "o por qué algo no funciona.",
  parameters: {
    type: "object",
    properties: {},
  },
  async execute() {
    const settings = await WebSettingsRepository.toRecord();
    const providerResolution = ChatProviderFactory.resolveProviderResolution();
    const toolPolicy = resolveChatToolPolicy();

    const groqConfigured = Boolean(settings["groq_api_key"] || process.env.GROQ_API_KEY);
    const geminiConfigured = Boolean(settings["gemini_api_key"] || process.env.GEMINI_API_KEY);
    const deepgramConfigured = Boolean(settings["deepgram_api_key"] || process.env.DEEPGRAM_API_KEY);
    const autoJoinEnabled = settings["calendar_auto_join_enabled"] === "true";
    const transcriptionProvider = settings["transcription_provider"] || "groq";
    const summaryProvider = settings["summary_provider"] || "gemini";
    const chatProvider = providerResolution.effectiveProvider ?? "unconfigured";

    // Credenciales de Google Service Account (archivo en disco)
    const googleCredentialsPath = process.env.GOOGLE_SERVICE_ACCOUNT_PATH;
    let hasGoogleCredentials = false;
    try {
      if (googleCredentialsPath) {
        const fs = await import("fs");
        hasGoogleCredentials = fs.existsSync(googleCredentialsPath);
      }
    } catch {
      hasGoogleCredentials = false;
    }

    const organizerEmails = (settings["auto_join_organizer_emails"] || "")
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);

    // Diagnóstico automático
    const diagnosis: string[] = [];
    let hasWarningsOrErrors = false;
    diagnosis.push(
      `ℹ️ Chat provider efectivo: ${chatProvider} (source: ${providerResolution.resolutionSource}${providerResolution.fallbackProvider ? `, fallback: ${providerResolution.fallbackProvider}` : ""})`,
    );
    diagnosis.push(
      `ℹ️ Chat tool policy activa: ${toolPolicy.activePolicy} (source: ${toolPolicy.resolutionSource})`,
    );
    if (!groqConfigured && transcriptionProvider === "groq") {
      hasWarningsOrErrors = true;
      diagnosis.push("⚠️ GROQ_API_KEY no configurada — las transcripciones fallarán");
    }
    if (!geminiConfigured && summaryProvider === "gemini") {
      hasWarningsOrErrors = true;
      diagnosis.push("⚠️ GEMINI_API_KEY no configurada — los resúmenes usarán Groq como fallback");
    }
    if (!groqConfigured && !geminiConfigured) {
      hasWarningsOrErrors = true;
      diagnosis.push("❌ Ningún provider de IA configurado — chat y resúmenes no funcionarán");
    }
    if (providerResolution.resolutionSource === "invalid-configured") {
      hasWarningsOrErrors = true;
      diagnosis.push(
        `❌ CHAT_PROVIDER inválido (${providerResolution.configuredProvider}) — revisá la configuración del provider de chat`,
      );
    }
    if (toolPolicy.configuredPolicy && toolPolicy.resolutionSource === "default") {
      hasWarningsOrErrors = true;
      diagnosis.push(
        `⚠️ CHAT_TOOL_POLICY inválida (${toolPolicy.configuredPolicy}) — se aplicó read-only por seguridad`,
      );
    }
    if (autoJoinEnabled && !hasGoogleCredentials) {
      hasWarningsOrErrors = true;
      diagnosis.push("⚠️ Auto-join activado pero no hay credenciales de Google Service Account");
    }
    if (autoJoinEnabled && organizerEmails.length === 0) {
      hasWarningsOrErrors = true;
      diagnosis.push("⚠️ Auto-join activado pero no hay emails de organizadores configurados");
    }
    if (!hasWarningsOrErrors) {
      diagnosis.push("✅ Sistema configurado correctamente");
    }

    return {
      providers: {
        groqConfigured,
        geminiConfigured,
        deepgramConfigured,
        transcriptionProvider,
        summaryProvider,
        chatProvider,
        chatProviderConfigured: providerResolution.configuredProvider,
        chatProviderFallback: providerResolution.fallbackProvider,
        chatProviderResolutionSource: providerResolution.resolutionSource,
      },
      chatPolicy: {
        activePolicy: toolPolicy.activePolicy,
        configuredPolicy: toolPolicy.configuredPolicy,
        resolutionSource: toolPolicy.resolutionSource,
        resolutionReason: toolPolicy.resolutionReason,
        allowedTools: toolPolicy.allowedToolNames,
        blockedMutatingTools: toolPolicy.blockedMutatingToolNames,
        legacyMutatingToolsFlag: toolPolicy.legacyMutatingToolsFlag,
      },
      calendar: {
        autoJoinEnabled,
        hasGoogleCredentials,
        organizerEmails,
      },
      diagnosis,
    };
  },
};

// ─── 4. enqueue_meeting ───────────────────────────────────────────────────────

export interface EnqueueMeetingArgs {
  meeting_url: string;
  bot_name?: string;
  duration_minutes?: number;
}

export const enqueueMeetingTool: ToolDefinition<EnqueueMeetingArgs, EnqueueMeetingResultForLLM> = {
  name: "enqueue_meeting",
  description:
    "Encola una reunión para que el bot la grabe. " +
    "Úsala SOLO cuando el usuario pida explícitamente grabar o enviar el bot a una URL. " +
    "Antes de ejecutar, confirma la URL con el usuario si hay ambigüedad. " +
    "Soporta Google Meet, Microsoft Teams y Zoom Web.",
  parameters: {
    type: "object",
    properties: {
      meeting_url: {
        type: "string",
        description: "URL completa de la reunión (Google Meet, Teams o Zoom Web)",
      },
      bot_name: {
        type: "string",
        description: "Nombre que usará el bot dentro de la reunión. Default: 'Squaads Bot'",
      },
      duration_minutes: {
        type: "number",
        description: "Duración máxima esperada de la reunión en minutos. Default: 60",
      },
    },
    required: ["meeting_url"],
  },
  mutates: true,
  async execute({ meeting_url, bot_name, duration_minutes }) {
    // No hay contexto de sesión threadeado en el tool-calling stack hoy —
    // resolvemos getServerSession directo acá (elección pragmática del
    // diseño, ver spec/features/009-meeting-ownership-sharing/plan.md).
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return {
        success: false,
        meetingId: null,
        message: "No se pudo resolver el usuario autenticado para asignar la reunión.",
        status: "error",
      };
    }

    // Validación básica de URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(meeting_url);
    } catch {
      return {
        success: false,
        meetingId: null,
        message: `URL inválida: "${meeting_url}". Debe ser una URL completa con https://`,
        status: "error",
      };
    }

    const supportedHosts = ["meet.google.com", "teams.microsoft.com", "zoom.us"];
    const isSupported = supportedHosts.some((host) => parsedUrl.hostname.includes(host));
    if (!isSupported) {
      return {
        success: false,
        meetingId: null,
        message: `Proveedor no soportado: ${parsedUrl.hostname}. Soportados: Google Meet, Teams, Zoom Web.`,
        status: "error",
      };
    }

    const id = crypto.randomUUID();
    const now = new Date();

    await MeetingRepository.insert({
      id,
      url: meeting_url,
      botName: bot_name ?? "Squaads Bot",
      durationMinutes: duration_minutes ?? 60,
      status: "pending",
      ownerId: session.user.id,
      createdAt: now,
      updatedAt: now,
    });

    return {
      success: true,
      meetingId: id,
      message: `Reunión encolada correctamente. El bot intentará unirse en breve.`,
      status: "pending",
    };
  },
};

// ─── 5. manage_meeting_share ──────────────────────────────────────────────────

export interface ManageShareListArgs {
  action: "list";
  meeting_id: string;
}

export interface ManageShareCreateArgs {
  action: "create";
  meeting_id: string;
  share_type: "restricted_email";
  recipient_email?: string;
  ttl_minutes?: number;
  no_expiry?: boolean;
}

export interface ManageShareRevokeArgs {
  action: "revoke";
  share_id: string;
}

export type ManageMeetingShareArgs =
  | ManageShareListArgs
  | ManageShareCreateArgs
  | ManageShareRevokeArgs;

export const manageMeetingShareTool: ToolDefinition<ManageMeetingShareArgs, ManageShareResultForLLM> = {
  name: "manage_meeting_share",
  description:
    "Gestiona los links de compartir de una reunión. " +
    "Acciones disponibles: " +
    "'list' — lista todos los shares activos de una reunión; " +
    "'create' — crea un link restringido a un email; " +
    "'revoke' — revoca un share por su ID. " +
    "El recipient_email es obligatorio para 'create'. " +
    "Solo el dueño de la reunión puede crear o revocar shares.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["list", "create", "revoke"],
        description: "Operación a realizar",
      },
      meeting_id: {
        type: "string",
        description: "ID de la reunión (requerido para 'list' y 'create')",
      },
      share_type: {
        type: "string",
        enum: ["restricted_email"],
        description: "Tipo de share (requerido para 'create'; único valor soportado: restricted_email)",
      },
      recipient_email: {
        type: "string",
        description: "Email del destinatario (requerido para 'create')",
      },
      ttl_minutes: {
        type: "number",
        description: "Tiempo de vida del link en minutos (para 'create'). Ignorado si no_expiry=true",
      },
      no_expiry: {
        type: "boolean",
        description: "Si es true, el link no expira (para 'create')",
      },
      share_id: {
        type: "string",
        description: "ID del share a revocar (requerido para 'revoke')",
      },
    },
    required: ["action"],
  },
  mutates: true,
  async execute(args) {
    // LIST — read-only, no ownership check yet (matches search_meetings/get_meeting_detail
    // on this branch; ownership-scoped reads land in the separate Phase 3 PR).
    if (args.action === "list") {
      const now = new Date();
      const shares = await MeetingShareRepository.listByMeetingId(args.meeting_id);
      const mapped = shares.map((s) => ({
        id: s.id,
        shareType: s.shareType,
        recipientEmail: s.recipientEmail ?? null,
        expiresAt: s.expiresAt?.toISOString() ?? null,
        isActive: !s.revokedAt && (!s.expiresAt || s.expiresAt > now),
        lastAccessedAt: s.lastAccessedAt?.toISOString() ?? null,
      }));

      return {
        action: "list",
        success: true,
        message: `${mapped.length} share(s) encontrado(s) para esta reunión.`,
        shares: mapped,
      };
    }

    // CREATE/REVOKE mutate share state — resolve the caller the same way
    // enqueueMeetingTool does (no session context threaded into the tool-calling
    // stack yet, see spec/features/009-meeting-ownership-sharing/plan.md) and
    // route through MeetingShareService so ownership is enforced instead of
    // calling MeetingShareRepository directly.
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return {
        action: args.action,
        success: false,
        message: "No se pudo resolver el usuario autenticado para gestionar este share.",
      };
    }

    // CREATE
    if (args.action === "create") {
      try {
        const result = await MeetingShareService.createShare(
          {
            meetingId: args.meeting_id,
            shareType: args.share_type,
            recipientEmail: args.recipient_email,
            ttlMinutes: args.ttl_minutes,
            noExpiry: args.no_expiry,
          },
          session.user.id,
        );

        return {
          action: "create",
          success: true,
          message: "Link de compartir creado correctamente.",
          createdShare: {
            id: result.id,
            shareUrl: result.shareUrl,
            shareType: result.shareType,
            expiresAt: result.expiresAt?.toISOString() ?? null,
          },
        };
      } catch (error) {
        return {
          action: "create",
          success: false,
          message: error instanceof Error ? error.message : "Error al crear el share.",
        };
      }
    }

    // REVOKE
    try {
      await MeetingShareService.revokeShare(args.share_id, session.user.id);
      return {
        action: "revoke",
        success: true,
        message: "Share revocado correctamente. El link dejará de funcionar de inmediato.",
      };
    } catch (error) {
      return {
        action: "revoke",
        success: false,
        message: error instanceof Error ? error.message : "Error al revocar el share.",
      };
    }
  },
};

// ─── Export del registry ──────────────────────────────────────────────────────

// Los arrays usan cast explícito porque ToolDefinition<TArgs> es contravariante
// en TArgs (posición de parámetro de función). Las herramientas individuales
// conservan sus tipos estrictos — el cast solo aplica al registry genérico.

/** Todas las tools disponibles para el Squaads Assistant */
export const ALL_TOOLS = [
  searchMeetingsTool,
  getMeetingDetailTool,
  getSystemStatusTool,
  enqueueMeetingTool,
  manageMeetingShareTool,
] as ToolDefinition[];

/** Solo tools de lectura — seguras sin confirmación */
export const READ_ONLY_TOOLS = ALL_TOOLS.filter((t) => !t.mutates);

/** Tools que mutan datos — requieren contexto de sesión y logging */
export const MUTATING_TOOLS = ALL_TOOLS.filter((t) => t.mutates);
