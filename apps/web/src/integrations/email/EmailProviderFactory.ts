import type { EmailProvider } from "@/integrations/email/EmailProvider";
import { ConsoleEmailProvider } from "@/integrations/email/providers/ConsoleEmailProvider";
import { SmtpEmailProvider } from "@/integrations/email/providers/SmtpEmailProvider";

export class EmailProviderFactory {
  private static instance: EmailProvider;

  static getProvider(): EmailProvider {
    if (this.instance) return this.instance;

    const providerType = process.env.EMAIL_PROVIDER?.toLowerCase() || "console";

    switch (providerType) {
      case "console":
        this.instance = new ConsoleEmailProvider();
        break;
      case "smtp":
        this.instance = new SmtpEmailProvider();
        break;
      default:
        console.warn(`[EmailProviderFactory] Unknown provider ${providerType}, defaulting to console`);
        this.instance = new ConsoleEmailProvider();
    }

    return this.instance;
  }
}
