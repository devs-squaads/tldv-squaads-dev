import type { SupportNotification, SupportProvider } from "@/integrations/support/SupportProvider";

export class ConsoleSupportProvider implements SupportProvider {
  readonly name = "console";

  async deliver(notification: SupportNotification): Promise<void> {
    console.log(`[Support:${this.name}]`, notification);
  }
}
