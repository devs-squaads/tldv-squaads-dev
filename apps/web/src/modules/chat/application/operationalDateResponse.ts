import type { MeetingSummaryForLLM } from "@/integrations/chat/tools/types";
import {
  inferRequestedDateYmd,
  isDateOperationalQuery,
  type ExecutedToolResult,
} from "@/integrations/chat/tools/suggestionValidator";

export type OperationalDateQueryType = "meetings" | "recordings" | "transcriptions";

export interface OperationalDateClassification {
  type: OperationalDateQueryType;
  normalizedDate: string | null;
}

const RECORDING_RELATED_STATUSES = new Set(["recording", "transcribing", "summarizing", "completed"]);
const MAX_ITEMS = 5;

function extractLatestSearchMeetings(toolResults: ExecutedToolResult[]): MeetingSummaryForLLM[] | null {
  for (let index = toolResults.length - 1; index >= 0; index--) {
    const item = toolResults[index];
    if (item?.name === "search_meetings" && Array.isArray(item.result)) {
      return item.result as MeetingSummaryForLLM[];
    }
  }

  return null;
}

function classifyType(userMessage: string): OperationalDateQueryType {
  const normalized = userMessage.toLowerCase();

  if (/\btranscripci(?:[oó]n|ones)\b/i.test(normalized)) {
    return "transcriptions";
  }

  if (/\bgrabaci(?:[oó]n|ones)\b/i.test(normalized)) {
    return "recordings";
  }

  return "meetings";
}

function formatMeetingName(meeting: MeetingSummaryForLLM): string {
  const name = meeting.name?.trim();
  return name && name.length > 0 ? name : "Reunión sin nombre";
}

function formatList(
  meetings: MeetingSummaryForLLM[],
  formatter: (meeting: MeetingSummaryForLLM, index: number) => string,
): string {
  const visible = meetings.slice(0, MAX_ITEMS);
  const items = visible.map((meeting, index) => `- ${formatter(meeting, index)}`);

  if (meetings.length > visible.length) {
    items.push(`- ... y ${meetings.length - visible.length} más.`);
  }

  return items.join("\n");
}

function formatMeetingLine(meeting: MeetingSummaryForLLM): string {
  const extras: string[] = [meeting.statusLabel];

  if (meeting.hasTranscription) extras.push("con transcripción");
  if (meeting.hasSummary) extras.push("con resumen");

  return `${formatMeetingName(meeting)} — ${extras.join(" · ")}`;
}

function formatRecordingLine(meeting: MeetingSummaryForLLM): string {
  const extras: string[] = [meeting.statusLabel];

  if (meeting.hasTranscription) {
    extras.push("transcripción disponible");
  } else if (meeting.hasSummary) {
    extras.push("resumen disponible");
  }

  return `${formatMeetingName(meeting)} — ${extras.join(" · ")}`;
}

function formatTranscriptionLine(meeting: MeetingSummaryForLLM): string {
  return `${formatMeetingName(meeting)} — Transcripción disponible`;
}

export function classifyOperationalDateQuery(
  userMessage: string,
  referenceDate: Date = new Date(),
): OperationalDateClassification | null {
  if (!isDateOperationalQuery(userMessage)) return null;

  return {
    type: classifyType(userMessage),
    normalizedDate: inferRequestedDateYmd(userMessage, referenceDate),
  };
}

export function buildDeterministicOperationalDateResponse(input: {
  userMessage: string;
  toolResults: ExecutedToolResult[];
  referenceDate?: Date;
}): string | null {
  const classification = classifyOperationalDateQuery(input.userMessage, input.referenceDate);
  if (!classification?.normalizedDate) return null;

  const meetings = extractLatestSearchMeetings(input.toolResults);
  if (!meetings) return null;

  const dateLabel = classification.normalizedDate;

  switch (classification.type) {
    case "meetings": {
      if (meetings.length === 0) {
        return `No encontré reuniones registradas en la base para ${dateLabel}.`;
      }

      return [
        `Encontré ${meetings.length} ${meetings.length === 1 ? "reunión registrada" : "reuniones registradas"} en la base para ${dateLabel}.`,
        formatList(meetings, formatMeetingLine),
      ].join("\n");
    }

    case "recordings": {
      const recordings = meetings.filter(
        (meeting) => RECORDING_RELATED_STATUSES.has(meeting.status) || meeting.hasTranscription || meeting.hasSummary,
      );

      if (recordings.length === 0) {
        if (meetings.length === 0) {
          return `No encontré reuniones con grabación o postproceso registrado para ${dateLabel}.`;
        }

        return [
          `No encontré reuniones con grabación o postproceso registrado para ${dateLabel}.`,
          `Sí hay ${meetings.length} ${meetings.length === 1 ? "reunión registrada" : "reuniones registradas"} ese día, pero ninguna alcanzó estados de grabación, transcripción, resumen o completado.`,
        ].join("\n");
      }

      return [
        `Encontré ${recordings.length} ${recordings.length === 1 ? "reunión con grabación o postproceso registrado" : "reuniones con grabación o postproceso registrado"} para ${dateLabel}.`,
        "Te listo reuniones, no archivos sueltos, porque esa es la entidad real modelada en la base.",
        formatList(recordings, formatRecordingLine),
      ].join("\n");
    }

    case "transcriptions": {
      const transcriptions = meetings.filter((meeting) => meeting.hasTranscription);

      if (transcriptions.length === 0) {
        if (meetings.length === 0) {
          return `No encontré reuniones con transcripción disponible para ${dateLabel}.`;
        }

        return [
          `No encontré reuniones con transcripción disponible para ${dateLabel}.`,
          `Sí hay ${meetings.length} ${meetings.length === 1 ? "reunión registrada" : "reuniones registradas"} ese día, pero ninguna tiene transcripción disponible.`,
        ].join("\n");
      }

      return [
        `Encontré ${transcriptions.length} ${transcriptions.length === 1 ? "reunión con transcripción disponible" : "reuniones con transcripción disponible"} para ${dateLabel}.`,
        formatList(transcriptions, formatTranscriptionLine),
      ].join("\n");
    }
  }
}
