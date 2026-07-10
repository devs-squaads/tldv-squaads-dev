import type { EmailProvider } from "@/integrations/email/EmailProvider";
import type {
  SharingProvider,
  SharingRequestAccessInput,
  SharingResolveDecision,
  SharingVerifyAccessInput,
} from "@/integrations/sharing/SharingProvider";
import { generateNumericOtp, hashOtp, secureCompare } from "@/integrations/sharing/utils";
import { MeetingShareRepository } from "@/repositories/MeetingShareRepository";
import type { MeetingShareRecord } from "@/repositories/MeetingShareRepository";

interface RestrictedEmailSharingProviderOptions {
  appBaseUrl: string;
  otpLength: number;
  otpTtlMinutes: number;
  emailProvider: EmailProvider;
}

export class RestrictedEmailSharingProvider implements SharingProvider {
  readonly type = "restricted_email" as const;
  private readonly appBaseUrl: string;
  private readonly otpLength: number;
  private readonly otpTtlMinutes: number;
  private readonly emailProvider: EmailProvider;

  constructor(options: RestrictedEmailSharingProviderOptions) {
    this.appBaseUrl = options.appBaseUrl.replace(/\/+$/, "");
    this.otpLength = options.otpLength;
    this.otpTtlMinutes = options.otpTtlMinutes;
    this.emailProvider = options.emailProvider;
  }

  async resolveAccess(share: MeetingShareRecord): Promise<SharingResolveDecision> {
    void share;
    return { authorized: false, requiresEmailVerification: true };
  }

  async requestAccess(input: SharingRequestAccessInput): Promise<void> {
    const recipient = input.share.recipientEmailNormalized;
    if (!recipient || recipient !== input.normalizedEmail) {
      return;
    }

    const otpCode = generateNumericOtp(this.otpLength);
    const otpHash = hashOtp(input.share.id, otpCode);
    const expiresAt = new Date(Date.now() + this.otpTtlMinutes * 60 * 1000);

    await MeetingShareRepository.setOtp(input.share.id, otpHash, expiresAt, new Date());

    const shareUrl = `${this.appBaseUrl}/share/${input.token}`;
    await this.emailProvider.send({
      to: recipient,
      subject: "Codigo de acceso a la reunion compartida",
      text:
        `Tu codigo de acceso es: ${otpCode}\n\n` +
        `Este codigo expira en ${this.otpTtlMinutes} minutos.\n` +
        `Enlace: ${shareUrl}\n`,
    });
  }

  async verifyAccess(input: SharingVerifyAccessInput): Promise<boolean> {
    const recipient = input.share.recipientEmailNormalized;
    if (!recipient || recipient !== input.normalizedEmail) {
      return false;
    }

    if (!input.share.otpHash || !input.share.otpExpiresAt) {
      return false;
    }

    if (input.share.otpExpiresAt.getTime() <= Date.now()) {
      return false;
    }

    const candidateHash = hashOtp(input.share.id, input.code.trim());
    if (!secureCompare(input.share.otpHash, candidateHash)) {
      return false;
    }

    await MeetingShareRepository.clearOtp(input.share.id, new Date());
    return true;
  }
}
