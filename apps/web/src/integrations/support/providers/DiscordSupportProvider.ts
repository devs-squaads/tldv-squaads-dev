import type { SupportNotification, SupportProvider } from "@/integrations/support/SupportProvider";

const DISCORD_CONTENT_LIMIT = 2000;
const WEBHOOK_TIMEOUT_MS = 5000;

function buildContent(notification: SupportNotification): string {
  const lines = [`Bug report from ${notification.reporterId}:`];
  if (notification.diagnostic.kind === "none") lines.push("This report has no meeting diagnostic log.");
  if (notification.diagnostic.kind === "meeting") {
    const { meetingId, status, errorMessage, sourceProvider, startsAt, endsAt } = notification.diagnostic;
    lines.push("Diagnostic:", `meetingId: ${meetingId}`, `status: ${status}`, `sourceProvider: ${sourceProvider ?? "unavailable"}`, `startsAt: ${startsAt?.toISOString() ?? "unavailable"}`, `endsAt: ${endsAt?.toISOString() ?? "unavailable"}`, `errorMessage: ${errorMessage ?? "unavailable"}`);
  }
  const diagnostic = lines.join("\n");
  const messageLimit = Math.max(0, DISCORD_CONTENT_LIMIT - diagnostic.length - 2);
  return `${diagnostic}\n\n${notification.message.slice(0, messageLimit)}`;
}

export class DiscordSupportProvider implements SupportProvider {
  readonly name = "discord";
  constructor(private readonly webhookUrl: string) {}

  async deliver(notification: SupportNotification): Promise<void> {
    let response: Response;
    try {
      response = await fetch(this.webhookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: buildContent(notification) }), signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS) });
    } catch {
      throw new Error("Support delivery failed");
    }
    if (!response.ok) throw new Error("Support delivery failed");
  }
}
