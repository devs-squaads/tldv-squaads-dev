import type { SupportProvider } from "@/integrations/support/SupportProvider";
import { ConsoleSupportProvider } from "@/integrations/support/providers/ConsoleSupportProvider";
import { DiscordSupportProvider } from "@/integrations/support/providers/DiscordSupportProvider";

export class SupportProviderFactory {
  static getProvider(): SupportProvider {
    const webhookUrl = process.env.DISCORD_BUGREPORT_WEBHOOK_URL?.trim();
    return webhookUrl && webhookUrl !== "REPLACE_WITH_DISCORD_WEBHOOK_URL" ? new DiscordSupportProvider(webhookUrl) : new ConsoleSupportProvider();
  }
}
