export interface BugReportFeedback { type: "success" | "error"; text: string; }
export interface BugReportRequestBody { message: string; meetingId?: string; }
export function getBugReportModeNote(meetingId?: string): string | null { return meetingId ? null : "Este reporte no incluye el diagnóstico de una reunión."; }
export function isBugReportSubmitDisabled(message: string, isSubmitting: boolean): boolean { return isSubmitting || message.trim().length === 0; }
export function buildBugReportRequestBody(message: string, meetingId?: string): BugReportRequestBody { const trimmed = message.trim(); return meetingId ? { message: trimmed, meetingId } : { message: trimmed }; }
export function resolveBugReportFeedback(ok: boolean, errorText?: string): BugReportFeedback { return ok ? { type: "success", text: "Reporte enviado. ¡Gracias!" } : { type: "error", text: errorText || "No pudimos enviar el reporte." }; }
