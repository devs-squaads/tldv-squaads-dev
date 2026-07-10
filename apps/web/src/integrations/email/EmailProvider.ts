import type { SendEmailInput } from "@/integrations/email/types";

export interface EmailProvider {
  readonly name: string;
  send(input: SendEmailInput): Promise<void>;
}
