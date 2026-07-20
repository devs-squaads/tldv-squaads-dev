import type { MeetingShareRecord } from "@/repositories/MeetingShareRepository";

export interface SharingResolveDecision {
  authorized: boolean;
  requiresEmailVerification: boolean;
}

export interface SharingRequestAccessInput {
  share: MeetingShareRecord;
  token: string;
  normalizedEmail: string;
}

export interface SharingVerifyAccessInput {
  share: MeetingShareRecord;
  normalizedEmail: string;
  code: string;
}

export interface SharingProvider {
  readonly type: "restricted_email";
  resolveAccess(share: MeetingShareRecord): Promise<SharingResolveDecision>;
  requestAccess(input: SharingRequestAccessInput): Promise<void>;
  verifyAccess(input: SharingVerifyAccessInput): Promise<boolean>;
}
