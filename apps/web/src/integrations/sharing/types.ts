export type ShareType = "restricted_email";
export type ShareStatus = "active" | "expired" | "revoked";

export interface CreateShareInput {
  meetingId: string;
  shareType: ShareType;
  recipientEmail?: string;
  ttlMinutes?: number;
  noExpiry?: boolean;
  createdBy?: string;
  // 013: unregistered-recipient-only; dies on first successful OTP verifyAccess() (ADR-0008).
  singleUse?: boolean;
  // 013/Phase 4.2 follow-up (PR3 fix): mirrors CreateGrantInput's accessType/expiresInDays —
  // takes priority over ttlMinutes/noExpiry above when present, bypassing shareTtl.ts's fixed
  // TTL menu for arbitrary day counts. "single_use" is NOT resolved through this pair; use the
  // singleUse field above instead (see resolveExpiresAtFromAccessType in meetingShareService.ts).
  accessType?: "single_use" | "temporary" | "permanent";
  expiresInDays?: number; // required when accessType === "temporary"
}

export interface ShareListItem {
  id: string;
  meetingId: string;
  shareType: ShareType;
  status: ShareStatus;
  recipientEmail: string | null;
  shareUrl: string;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  isActive: boolean;
  // 013: surfaced so the UI can show an access-type badge (single-use/temporary/permanent)
  // without re-deriving it — the DB row already carries this (ADR-0008).
  singleUse: boolean;
}

export interface RenewShareInput {
  shareId: string;
  ttlMinutes?: number;
  noExpiry?: boolean;
}

export interface ShareCreationResult {
  id: string;
  shareType: ShareType;
  recipientEmail: string | null;
  expiresAt: Date | null;
  shareUrl: string;
  singleUse: boolean;
}

export type PublicShareResolveResult =
  | { status: "ok"; shareType: ShareType; meeting: PublicSharedMeetingPayload }
  | { status: "requires_email_verification"; shareType: "restricted_email" }
  | { status: "not_found" };

export interface PublicSharedMeetingPayload {
  id: string;
  title: string | null;
  url: string;
  createdAt: Date;
  summary: string | null;
  rawTranscription: string | null;
  recordingUrl: string | null;
}
