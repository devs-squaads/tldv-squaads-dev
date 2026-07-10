/**
 * Tool Calling — Base Types
 *
 * Agnóstico de proveedor. Groq usa formato OpenAI-compatible,
 * Gemini usa functionDeclarations. Los providers adaptan estos tipos
 * al formato que cada SDK espera.
 */

// ─── JSON Schema (subset compatible con Groq + Gemini) ───────────────────────

export type JsonSchemaType = "string" | "number" | "boolean" | "array" | "object";

export interface JsonSchemaProperty {
  type: JsonSchemaType;
  description?: string;
  /** Para string con valores acotados */
  enum?: string[];
  /** Para arrays: tipo de los items */
  items?: JsonSchemaProperty;
  /** Para objects: propiedades hijas */
  properties?: Record<string, JsonSchemaProperty>;
  /** Propiedades requeridas del objeto */
  required?: string[];
}

export interface ToolParameterSchema {
  type: "object";
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
}

// ─── Tool Definition ──────────────────────────────────────────────────────────

/**
 * Definición completa de una herramienta.
 * TArgs: tipo de los argumentos que parsea el LLM.
 * TResult: tipo del valor que retorna execute() y se serializa para el LLM.
 */
export interface ToolDefinition<
  TArgs extends object = Record<string, unknown>,
  TResult = unknown,
> {
  /** Nombre snake_case — lo usa el LLM para invocarla */
  name: string;
  /** Descripción clara: cuándo usarla y qué retorna */
  description: string;
  /** JSON Schema de los parámetros */
  parameters: ToolParameterSchema;
  /** Implementación real — se ejecuta en el servidor */
  execute: (args: TArgs) => Promise<TResult>;
  /**
   * true = la tool muta datos (crea, borra, encola).
   * El loop puede usarlo para pedir confirmación o logear.
   */
  mutates?: boolean;
}

// ─── Tool Call Request (LLM → servidor) ──────────────────────────────────────

/** Lo que el LLM envía cuando decide llamar una tool */
export interface ToolCallRequest {
  /** ID único del call — lo genera el LLM, hay que devolvérselo en el resultado */
  id: string;
  /** Nombre de la tool a invocar */
  name: string;
  /** Argumentos como JSON string (hay que hacer JSON.parse antes de usar) */
  arguments: string;
}

// ─── Tipos de respuesta de cada tool ─────────────────────────────────────────

/** Lo que el LLM recibe como resultado de search_meetings */
export interface MeetingSummaryForLLM {
  id: string;
  name: string | null;
  url: string;
  status: string;
  statusLabel: string;
  errorMessage: string | null;
  hasTranscription: boolean;
  hasSummary: boolean;
  startsAt: string | null;
  createdAt: string;
  durationMinutes: number | null;
}

/** Lo que el LLM recibe como resultado de get_meeting_detail */
export interface MeetingDetailForLLM extends MeetingSummaryForLLM {
  /** Resumen estructurado parseado — null si no existe */
  summaryData: {
    summary: string;
    actionItems: string[];
    keyMoments: Array<{ timeSeconds: number; title: string; description: string }>;
  } | null;
  /** Transcripción raw — solo si se solicitó explícitamente */
  transcription: string | null;
  /** Shares activos — solo count para no saturar el contexto */
  activeSharesCount: number;
}

/** Lo que el LLM recibe como resultado de get_system_status */
export interface SystemStatusForLLM {
  providers: {
    groqConfigured: boolean;
    geminiConfigured: boolean;
    deepgramConfigured: boolean;
    transcriptionProvider: string;
    summaryProvider: string;
    chatProvider: string;
    chatProviderConfigured: string | null;
    chatProviderFallback: string | null;
    chatProviderResolutionSource: string;
  };
  chatPolicy: {
    activePolicy: string;
    configuredPolicy: string | null;
    resolutionSource: string;
    resolutionReason: string;
    allowedTools: string[];
    blockedMutatingTools: string[];
    legacyMutatingToolsFlag: "true" | "false" | null;
  };
  calendar: {
    autoJoinEnabled: boolean;
    hasGoogleCredentials: boolean;
    organizerEmails: string[];
  };
  /** Diagnóstico listo para leer — el LLM lo puede mostrar directo */
  diagnosis: string[];
}

/** Lo que el LLM recibe como resultado de enqueue_meeting */
export interface EnqueueMeetingResultForLLM {
  success: boolean;
  meetingId: string | null;
  message: string;
  /** Estado inicial del meeting creado */
  status: string;
}

/** Lo que el LLM recibe como resultado de manage_meeting_share */
export interface ManageShareResultForLLM {
  action: "list" | "create" | "revoke";
  success: boolean;
  message: string;
  shares?: Array<{
    id: string;
    shareType: string;
    recipientEmail: string | null;
    expiresAt: string | null;
    isActive: boolean;
    lastAccessedAt: string | null;
  }>;
  /** Presente solo cuando action === "create" */
  createdShare?: {
    id: string;
    shareUrl: string;
    shareType: string;
    expiresAt: string | null;
  };
}
