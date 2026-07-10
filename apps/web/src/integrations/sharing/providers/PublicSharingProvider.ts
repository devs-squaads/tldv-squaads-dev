import type {
  SharingProvider,
  SharingRequestAccessInput,
  SharingResolveDecision,
  SharingVerifyAccessInput,
} from "@/integrations/sharing/SharingProvider";
import type { MeetingShareRecord } from "@/repositories/MeetingShareRepository";

export class PublicSharingProvider implements SharingProvider {
  readonly type = "public" as const;

  async resolveAccess(share: MeetingShareRecord): Promise<SharingResolveDecision> {
    void share;
    return { authorized: true, requiresEmailVerification: false };
  }

  async requestAccess(input: SharingRequestAccessInput): Promise<void> {
    void input;
    // Public shares do not require email verification.
  }

  async verifyAccess(input: SharingVerifyAccessInput): Promise<boolean> {
    void input;
    // Public shares do not require OTP verification.
    return true;
  }
}
