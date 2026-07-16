/// <reference types="bun" />

import { afterEach, describe, expect, it, mock } from "bun:test";
import { SupportProviderFactory } from "../../../web/src/integrations/support/SupportProviderFactory";
import { ConsoleSupportProvider } from "../../../web/src/integrations/support/providers/ConsoleSupportProvider";
import { DiscordSupportProvider } from "../../../web/src/integrations/support/providers/DiscordSupportProvider";

const webhookUrl = "https://discord.example/webhook/FAKE";
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.DISCORD_BUGREPORT_WEBHOOK_URL;
  mock.restore();
});

const notification = {
  reporterId: "user-1",
  message: "x".repeat(3000),
  diagnostic: { kind: "none" as const },
};

describe("support providers", () => {
  it("uses a console provider when no webhook is configured and Discord otherwise", () => {
    expect(SupportProviderFactory.getProvider()).toBeInstanceOf(ConsoleSupportProvider);
    process.env.DISCORD_BUGREPORT_WEBHOOK_URL = webhookUrl;
    expect(SupportProviderFactory.getProvider()).toBeInstanceOf(DiscordSupportProvider);
  });

  it("uses a console provider for the env-template webhook placeholder", () => {
    process.env.DISCORD_BUGREPORT_WEBHOOK_URL = "REPLACE_WITH_DISCORD_WEBHOOK_URL";

    expect(SupportProviderFactory.getProvider()).toBeInstanceOf(ConsoleSupportProvider);
  });

  it("caps Discord content and labels a general report without a diagnostic log", async () => {
    let body = "";
    globalThis.fetch = mock((_url, init) => {
      body = String(init?.body);
      return Promise.resolve(new Response(null, { status: 204 }));
    }) as typeof fetch;

    await new DiscordSupportProvider(webhookUrl).deliver(notification);
    const content = (JSON.parse(body) as { content: string }).content;
    expect(content.length).toBeLessThanOrEqual(2000);
    expect(content).toContain("no meeting diagnostic log");
  });

  it("preserves meeting diagnostics when truncating a long report", async () => {
    let body = "";
    globalThis.fetch = mock((_url, init) => {
      body = String(init?.body);
      return Promise.resolve(new Response(null, { status: 204 }));
    }) as typeof fetch;

    await new DiscordSupportProvider(webhookUrl).deliver({
      reporterId: "user-1",
      message: "x".repeat(3000),
      diagnostic: { kind: "meeting", meetingId: "meeting-1", status: "error", errorMessage: "failure", sourceProvider: "google-meet", startsAt: null, endsAt: null },
    });

    const content = (JSON.parse(body) as { content: string }).content;
    expect(content.length).toBeLessThanOrEqual(2000);
    expect(content).toContain("meetingId: meeting-1");
    expect(content).toContain("errorMessage: failure");
  });

  it("sanitizes failed webhook errors and does not leak the webhook URL", async () => {
    globalThis.fetch = mock(() => Promise.reject(new TypeError(`fetch ${webhookUrl} failed`))) as typeof fetch;
    await expect(new DiscordSupportProvider(webhookUrl).deliver(notification)).rejects.toThrow("Support delivery failed");
    try {
      await new DiscordSupportProvider(webhookUrl).deliver(notification);
    } catch (error) {
      expect(String(error)).not.toContain(webhookUrl);
    }
  });
});
