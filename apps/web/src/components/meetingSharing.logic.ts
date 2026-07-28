/**
 * Pure recipient/access-type/cancel logic for `MeetingDetailsView`'s sharing card (013 Phase 6.6).
 * Kept separate from JSX per AGENTS.md's TDD convention (`*.logic.ts`, mirrored under
 * `apps/__tests__/web/components/`).
 */

export type RecipientAccessType = "single_use" | "temporary" | "permanent";
export type RecipientMode = "all" | "subset" | "email";

export interface RecipientCandidate {
  email: string;
  /** Set when the email matches a registered user — routes to the Access Grant flow. */
  granteeUserId: string | null;
}

/** Spec: "permanent MUST be the default access type for Participants" — kept as the universal default. */
export const DEFAULT_ACCESS_TYPE: RecipientAccessType = "permanent";

/** Spec: "temporary MUST let the Owner set any day count, with 15 days pre-filled as the default". */
export const DEFAULT_TEMPORARY_DAYS = 15;

/**
 * Expands a recipient-selection mode into the concrete recipients to process — one row per
 * recipient, never bundled (spec: "Recipient-selection modes").
 */
export function resolveRecipients(params: {
  mode: RecipientMode;
  participants: RecipientCandidate[];
  selectedEmails: string[];
  manualRecipient: RecipientCandidate | null;
}): RecipientCandidate[] {
  if (params.mode === "all") return params.participants;
  if (params.mode === "subset") {
    const selected = new Set(params.selectedEmails);
    return params.participants.filter((p) => selected.has(p.email));
  }
  return params.manualRecipient ? [params.manualRecipient] : [];
}

/**
 * single_use is only offered when every recipient in the batch is unregistered (spec: "Access
 * types and defaults" — "single_use MUST be offered ONLY for unregistered recipients").
 */
export function getAvailableAccessTypes(recipients: RecipientCandidate[]): RecipientAccessType[] {
  const allUnregistered = recipients.length > 0 && recipients.every((r) => r.granteeUserId === null);
  return allUnregistered ? ["single_use", "temporary", "permanent"] : ["temporary", "permanent"];
}

/** Validates the access-type + day-count + recipient-batch combination before submit. */
export function validateAccessTypeSelection(params: {
  accessType: RecipientAccessType;
  recipients: RecipientCandidate[];
  expiresInDays: number | null;
}): string | null {
  if (params.recipients.length === 0) {
    return "Selecciona al menos un destinatario.";
  }
  if (params.accessType === "single_use" && params.recipients.some((r) => r.granteeUserId !== null)) {
    return "El acceso de un solo uso solo está disponible para destinatarios sin cuenta.";
  }
  if (params.accessType === "temporary" && (!params.expiresInDays || params.expiresInDays <= 0)) {
    return "Ingresa una cantidad de días válida para el acceso temporal.";
  }
  return null;
}

/**
 * The `member` who created a pending `Share Request` MAY cancel it; nobody else MAY (spec:
 * "Share Request lifecycle" + "Only the author may cancel").
 */
export function canCancelShareRequest(
  request: { status: string; requesterId: string },
  callerId: string | null | undefined
): boolean {
  return request.status === "pending" && Boolean(callerId) && request.requesterId === callerId;
}

export type ShareAccessTypeLabel =
  | { kind: "single_use"; label: string }
  | { kind: "permanent"; label: string }
  | { kind: "temporary"; label: string; expiresAt: Date };

/**
 * Derives the "Enlaces de acceso restringido" access-type badge from fields the share row
 * already carries — no new data needed (human feedback: rows showed no access-type info at a
 * glance). single_use always wins (a single-use link is never "permanent" even though it also
 * has no expiresAt); temporary carries its expiresAt for the caller to format/display.
 */
export function resolveShareAccessTypeLabel(share: { singleUse: boolean; expiresAt: Date | null }): ShareAccessTypeLabel {
  if (share.singleUse) return { kind: "single_use", label: "Único uso" };
  if (share.expiresAt === null) return { kind: "permanent", label: "Permanente" };
  return { kind: "temporary", label: "Temporal", expiresAt: share.expiresAt };
}
