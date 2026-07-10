import type { EmailProvider } from "@/integrations/email/EmailProvider";
import type { SendEmailInput } from "@/integrations/email/types";

export class ConsoleEmailProvider implements EmailProvider {
  readonly name = "console";

  async send(input: SendEmailInput): Promise<void> {
    console.log(`[Email:${this.name}] to=${input.to} subject=${input.subject}`);
    console.log(`[Email:${this.name}] text=${input.text}`);
  }
}
