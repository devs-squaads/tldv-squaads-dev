import { createTransport, type Transporter } from "nodemailer";
import type { EmailProvider } from "@/integrations/email/EmailProvider";
import { ConsoleEmailProvider } from "@/integrations/email/providers/ConsoleEmailProvider";
import type { SendEmailInput } from "@/integrations/email/types";

interface SmtpEnvConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

function readSmtpConfig(): SmtpEnvConfig | null {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  const from = process.env.SMTP_FROM?.trim();
  const port = Number(process.env.SMTP_PORT?.trim());

  if (!host || !user || !pass || !from || !Number.isFinite(port)) return null;

  return { host, port, user, pass, from };
}

export class SmtpEmailProvider implements EmailProvider {
  readonly name = "smtp";

  private readonly transportFactory: () => Transporter;
  private readonly consoleFallback = new ConsoleEmailProvider();

  constructor(transportFactory?: () => Transporter) {
    this.transportFactory =
      transportFactory ??
      (() => {
        const config = readSmtpConfig();
        // ponytail: only called once config is known complete (guarded in send()), non-null assert is safe here.
        return createTransport({
          host: config!.host,
          port: config!.port,
          secure: config!.port === 465,
          auth: { user: config!.user, pass: config!.pass },
        });
      });
  }

  async send(input: SendEmailInput): Promise<void> {
    const config = readSmtpConfig();

    if (!config) {
      if (process.env.NODE_ENV === "production") {
        throw new Error(
          "[SmtpEmailProvider] SMTP configuration is incomplete in production (SMTP_HOST/PORT/USER/PASS/FROM required); refusing to send.",
        );
      }

      await this.consoleFallback.send(input);
      return;
    }

    const transporter = this.transportFactory();
    await transporter.sendMail({
      from: config.from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
  }
}
