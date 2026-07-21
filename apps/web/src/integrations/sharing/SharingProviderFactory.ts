import { EmailProviderFactory } from "@/integrations/email/EmailProviderFactory";
import type { SharingProvider } from "@/integrations/sharing/SharingProvider";
import { RestrictedEmailSharingProvider } from "@/integrations/sharing/providers/RestrictedEmailSharingProvider";
import type { ShareType } from "@/integrations/sharing/types";

function parseIntEnv(name: string, fallback: number): number {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function getAppBaseUrl(): string {
  const fromEnv =
    process.env.SHARE_APP_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_BASE_URL;

  return (fromEnv || "http://localhost:3000").replace(/\/+$/, "");
}

export class SharingProviderFactory {
  static getProvider(shareType: ShareType): SharingProvider {
    switch (shareType) {
      case "restricted_email":
        return new RestrictedEmailSharingProvider({
          appBaseUrl: getAppBaseUrl(),
          otpLength: parseIntEnv("SHARE_OTP_LENGTH", 6),
          otpTtlMinutes: parseIntEnv("SHARE_OTP_TTL_MINUTES", 10),
          emailProvider: EmailProviderFactory.getProvider(),
        });
      default:
        throw new Error(`Unsupported sharing provider type: ${shareType}`);
    }
  }
}
