export type ShareType = "restricted_email";
export type ShareStatus = "active" | "expired" | "revoked";

export interface CreateShareInput {
  meetingId: string;
  shareType: ShareType;
  recipientEmail?: string;
  ttlMinutes?: number;
  noExpiry?: boolean;
  createdBy?: string;
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
