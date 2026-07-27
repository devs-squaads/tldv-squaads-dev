/// <reference types="bun" />

import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { Transporter } from "nodemailer";
import { EmailProviderFactory } from "../../../web/src/integrations/email/EmailProviderFactory";
import { SmtpEmailProvider } from "../../../web/src/integrations/email/providers/SmtpEmailProvider";

const ENV_KEYS = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM", "NODE_ENV", "EMAIL_PROVIDER"] as const;
const savedEnv: Record<string, string | undefined> = {};

function setCompleteSmtpEnv() {
  process.env.SMTP_HOST = "smtp.example.com";
  process.env.SMTP_PORT = "587";
  process.env.SMTP_USER = "bot@example.com";
  process.env.SMTP_PASS = "secret";
  process.env.SMTP_FROM = "noreply@example.com";
}

function resetFactorySingleton() {
  (EmailProviderFactory as unknown as { instance?: unknown }).instance = undefined;
}

for (const key of ENV_KEYS) savedEnv[key] = process.env[key];

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  mock.restore();
});

describe("SmtpEmailProvider", () => {
  it("sends via the injected transport when SMTP config is complete", async () => {
    setCompleteSmtpEnv();
    const sendMail = mock(() => Promise.resolve());
    const fakeTransporter = { sendMail } as unknown as Transporter;
    const provider = new SmtpEmailProvider(() => fakeTransporter);

    await provider.send({ to: "recipient@example.com", subject: "Hello", text: "plain", html: "<p>plain</p>" });

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0]?.[0]).toMatchObject({
      from: "noreply@example.com",
      to: "recipient@example.com",
      subject: "Hello",
      text: "plain",
      html: "<p>plain</p>",
    });
  });

  it("falls back to console logging when config is missing outside production", async () => {
    delete process.env.SMTP_HOST;
    process.env.NODE_ENV = "development";
    const logSpy = spyOn(console, "log").mockImplementation(() => undefined);
    const sendMail = mock(() => Promise.resolve());
    const provider = new SmtpEmailProvider(() => ({ sendMail }) as unknown as Transporter);

    await expect(provider.send({ to: "recipient@example.com", subject: "Hello", text: "plain" })).resolves.toBeUndefined();

    expect(sendMail).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
    expect(logSpy.mock.calls.some((call) => String(call[0]).includes("to=recipient@example.com"))).toBe(true);
  });

  it("throws in production when config is missing, and never logs to console as a delivery substitute", async () => {
    delete process.env.SMTP_HOST;
    process.env.NODE_ENV = "production";
    const logSpy = spyOn(console, "log").mockImplementation(() => undefined);
    const sendMail = mock(() => Promise.resolve());
    const provider = new SmtpEmailProvider(() => ({ sendMail }) as unknown as Transporter);

    await expect(provider.send({ to: "recipient@example.com", subject: "Hello", text: "plain" })).rejects.toThrow();

    expect(sendMail).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });
});

describe("EmailProviderFactory smtp selection", () => {
  afterEach(() => resetFactorySingleton());

  it("returns a SmtpEmailProvider when EMAIL_PROVIDER=smtp", () => {
    resetFactorySingleton();
    process.env.EMAIL_PROVIDER = "smtp";

    expect(EmailProviderFactory.getProvider()).toBeInstanceOf(SmtpEmailProvider);
  });
});
