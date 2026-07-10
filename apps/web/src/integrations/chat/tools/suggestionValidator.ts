import type { ChatSuggestion } from "@/integrations/chat/ChatProvider";

export interface ExecutedToolResult {
  name: string;
  result: unknown;
}

interface MeetingResultLike {
  id?: string;
  name?: string | null;
  hasTranscription?: boolean;
}

const MAX_SUGGESTIONS = 3;

const MONTH_INDEX_BY_NAME: Record<string, number> = {
  enero: 0,
  febrero: 1,
  marzo: 2,
  abril: 3,
  mayo: 4,
  junio: 5,
  julio: 6,
  agosto: 7,
  septiembre: 8,
  setiembre: 8,
  octubre: 9,
  noviembre: 10,
  diciembre: 11,
};

/**
 * Palabras clave que indican que la consulta del usuario requiere
 * llamar una herramienta de datos (reuniones, estado, etc.).
 * Se usa para forzar tool_choice: required en el primer turno.
 */
const DATA_QUERY_PATTERN =
  /\b(día|dia|fecha|cuando|cuándo|reunión|reunion|reuniones|grabación|grabacion|grabaciones|transcripci[oó]n|resumen|summary|cuántos|cuantos|cuántas|cuantas|error|fallo|estado|pending|completed|hoy|ayer|semana|mes|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|enero|febrero)\b/i;

const DATE_QUERY_PATTERN =
  /\b(hoy|ayer|anteayer|fecha|día|dia|semana|mes|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre|\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)\b/i;

export function requiresDataTool(userMessage: string): boolean {
  return DATA_QUERY_PATTERN.test(userMessage);
}

export function isDateOperationalQuery(userMessage: string): boolean {
  return DATE_QUERY_PATTERN.test(userMessage);
}

// ─── Validación de IDs en sugerencias ────────────────────────────────────────

function extractRealMeetingIds(toolResults: ExecutedToolResult[]): Set<string> {
  const ids = new Set<string>();

  for (const { name, result } of toolResults) {
    if (name === "search_meetings" && Array.isArray(result)) {
      for (const m of result as Array<{ id?: string }>) {
        if (m.id) ids.add(m.id);
      }
    }
    if (name === "get_meeting_detail" && result && typeof result === "object") {
      const m = result as { id?: string };
      if (m.id) ids.add(m.id);
    }
  }

  return ids;
}

function toYmd(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatYmdForHumans(dateYmd: string): string {
  const match = dateYmd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return dateYmd;
  return `${match[3]}/${match[2]}`;
}

export function inferRequestedDateYmd(userMessage: string, referenceDate: Date = new Date()): string | null {
  const normalized = userMessage.toLowerCase();

  const isoMatch = normalized.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const monthIndex = Number(isoMatch[2]) - 1;
    const day = Number(isoMatch[3]);
    const date = new Date(year, monthIndex, day);
    if (!Number.isNaN(date.getTime())) return toYmd(date);
  }

  const slashMatch = normalized.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (slashMatch) {
    const day = Number(slashMatch[1]);
    const monthIndex = Number(slashMatch[2]) - 1;
    const yearRaw = slashMatch[3];
    const year = yearRaw
      ? yearRaw.length === 2
        ? Number(`20${yearRaw}`)
        : Number(yearRaw)
      : referenceDate.getFullYear();
    const date = new Date(year, monthIndex, day);
    if (!Number.isNaN(date.getTime())) return toYmd(date);
  }

  if (/\banteayer\b/.test(normalized)) {
    const date = new Date(referenceDate);
    date.setDate(date.getDate() - 2);
    return toYmd(date);
  }

  if (/\bayer\b/.test(normalized)) {
    const date = new Date(referenceDate);
    date.setDate(date.getDate() - 1);
    return toYmd(date);
  }

  if (/\bhoy\b/.test(normalized)) {
    return toYmd(referenceDate);
  }

  const dayWithMonthMatch = normalized.match(
    /\b(?:día|dia)\s*(\d{1,2})(?:\s*(?:de|del)\s*([a-záéíóúñ]+))?\b/,
  );
  if (dayWithMonthMatch) {
    const day = Number(dayWithMonthMatch[1]);
    const monthName = dayWithMonthMatch[2]
      ? dayWithMonthMatch[2]
          .normalize("NFD")
          .replace(/\p{M}/gu, "")
          .toLowerCase()
      : null;

    if (!monthName) return null;
    const monthIndex = MONTH_INDEX_BY_NAME[monthName];
    if (monthIndex === undefined) return null;

    const date = new Date(referenceDate.getFullYear(), monthIndex, day);
    if (!Number.isNaN(date.getTime())) return toYmd(date);
  }

  return null;
}

function extractSearchMeetings(toolResults: ExecutedToolResult[]): MeetingResultLike[] {
  for (let index = toolResults.length - 1; index >= 0; index--) {
    const result = toolResults[index];
    if (result?.name === "search_meetings" && Array.isArray(result.result)) {
      return result.result as MeetingResultLike[];
    }
  }
  return [];
}

function hasMeetingId(meeting: MeetingResultLike): meeting is MeetingResultLike & { id: string } {
  return typeof meeting.id === "string" && meeting.id.length > 0;
}

function hasTranscription(meeting: MeetingResultLike): meeting is MeetingResultLike & { id: string; hasTranscription: true } {
  return hasMeetingId(meeting) && meeting.hasTranscription === true;
}

function buildSuggestionKey(suggestion: ChatSuggestion): string {
  const action = suggestion.action;
  const id = suggestion.payload?.id ?? "";
  const date = suggestion.payload?.date ?? "";
  const filter = suggestion.payload?.filter ?? "";
  return `${action}|${id}|${date}|${filter}`;
}

function formatMeetingLabel(meeting: MeetingResultLike): string {
  return meeting.name?.trim() || "Reunión sin nombre";
}

function pushUniqueSuggestion(
  collection: ChatSuggestion[],
  seen: Set<string>,
  suggestion: ChatSuggestion,
): void {
  if (collection.length >= MAX_SUGGESTIONS) return;
  const key = buildSuggestionKey(suggestion);
  if (seen.has(key)) return;
  collection.push(suggestion);
  seen.add(key);
}

export function buildDeterministicDateSuggestions(input: {
  userMessage: string;
  toolResults: ExecutedToolResult[];
  currentSuggestions: ChatSuggestion[];
}): ChatSuggestion[] {
  const { userMessage, toolResults, currentSuggestions } = input;

  if (!isDateOperationalQuery(userMessage)) return currentSuggestions;

  const meetings = extractSearchMeetings(toolResults).filter(hasMeetingId);
  const requestedDateYmd = inferRequestedDateYmd(userMessage);

  const suggestions: ChatSuggestion[] = [];
  const seen = new Set<string>();

  if (requestedDateYmd) {
    pushUniqueSuggestion(suggestions, seen, {
      label: `Ver reuniones del ${formatYmdForHumans(requestedDateYmd)}`,
      action: "view_meetings",
      payload: { date: requestedDateYmd },
    });
  }

  const currentTranscriptionSuggestions = currentSuggestions.filter((suggestion) => suggestion.action === "view_transcription");
  for (const suggestion of currentTranscriptionSuggestions) {
    pushUniqueSuggestion(suggestions, seen, suggestion);
  }

  for (const meeting of meetings.filter(hasTranscription)) {
    pushUniqueSuggestion(suggestions, seen, {
      label: `Ver transcripción · ${formatMeetingLabel(meeting)}`,
      action: "view_transcription",
      payload: { id: meeting.id },
    });
  }

  if (!suggestions.some((suggestion) => suggestion.action === "view_transcription")) {
    for (const meeting of meetings) {
      pushUniqueSuggestion(suggestions, seen, {
        label: formatMeetingLabel(meeting),
        action: "view_meeting_detail",
        payload: { id: meeting.id },
      });
    }
  }

  for (const suggestion of currentSuggestions) {
    if (suggestion.action === "view_meetings" && requestedDateYmd && suggestion.payload?.date !== requestedDateYmd) {
      continue;
    }
    pushUniqueSuggestion(suggestions, seen, suggestion);
  }

  return suggestions;
}

/**
 * Valida que los IDs en los payload de sugerencias existan en los resultados
 * reales de las tools. Elimina botones con IDs inventados.
 *
 * Sugerencias sin payload.id (open_settings, install_extension, view_meetings
 * con filter) se dejan pasar siempre.
 */
export function validateSuggestions(
  rawSuggestions: ChatSuggestion[],
  toolResults: ExecutedToolResult[],
): ChatSuggestion[] {
  const realIds = extractRealMeetingIds(toolResults);

  // Sin resultados de reuniones, no permitimos sugerencias con payload.id
  // para evitar IDs inventados por el modelo.
  if (realIds.size === 0) {
    return rawSuggestions.filter((s) => !s.payload?.id);
  }

  return rawSuggestions.filter((s) => {
    const id = s.payload?.id;
    if (!id) return true; // sugerencia sin ID de reunión — siempre válida
    return realIds.has(id); // eliminar si el ID no vino de la DB
  });
}
