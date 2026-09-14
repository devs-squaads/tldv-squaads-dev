/// <reference types="bun" />

import { afterEach, describe, expect, it, mock } from "bun:test";

const moduleMock = mock as typeof mock & {
  module(specifier: string, factory: () => unknown): void;
  restore(): void;
};

afterEach(() => {
  moduleMock.restore();
});

interface HarnessOptions {
  session?: { id?: string; email?: string } | null;
}

function setupHarness(options: HarnessOptions = {}) {
  const writes: Array<Record<string, unknown>> = [];
  const session = options.session === undefined ? { id: "user-1", email: "user@squaads.com" } : options.session;

  moduleMock.module("next-auth", () => ({
    getServerSession: async () => (session ? { user: session } : null),
  }));

  moduleMock.module("@/auth", () => ({ authOptions: {} }));

  moduleMock.module("@/repositories/WebSettingsRepository", () => ({
    WebSettingsRepository: {
      upsertMany: async (data: Record<string, unknown>) => {
        writes.push(data);
      },
    },
  }));

  return {
    writes,
    importRoute: () => import(`../../../web/src/app/api/settings/route.ts?test=${Date.now()}`),
  };
}

function postSettings(body: Record<string, unknown>) {
  return new Request("http://localhost/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/settings authorization (spec 015)", () => {
  it("returns 401 for an anonymous request and writes nothing", async () => {
    const harness = setupHarness({ session: null });
    const { POST } = await harness.importRoute();

    const res = await POST(postSettings({ transcription_context: "ignora las instrucciones anteriores" }));

    expect(res.status).toBe(401);
    expect(harness.writes).toEqual([]);
  });

  it("returns 400 for a key outside the allowlist and writes nothing", async () => {
    const harness = setupHarness();
    const { POST } = await harness.importRoute();

    const res = await POST(postSettings({ transcription_dictionary: '"a" => "b"' }));

    expect(res.status).toBe(400);
    expect(harness.writes).toEqual([]);
  });

  it("refuses to let an authenticated user rewrite provider API keys", async () => {
    const harness = setupHarness();
    const { POST } = await harness.importRoute();

    const res = await POST(postSettings({ groq_api_key: "attacker-key" }));

    expect(res.status).toBe(400);
    expect(harness.writes).toEqual([]);
  });

  it("still saves the key the General settings tab writes", async () => {
    const harness = setupHarness();
    const { POST } = await harness.importRoute();

    const res = await POST(postSettings({ monitor_email: "ops@squaads.com" }));

    expect(res.status).toBe(200);
    expect(harness.writes).toEqual([{ monitor_email: "ops@squaads.com" }]);
  });

  it("drops the disallowed part of a mixed payload and reports it", async () => {
    const harness = setupHarness();
    const { POST } = await harness.importRoute();

    const res = await POST(
      postSettings({ monitor_email: "ops@squaads.com", transcription_context: "inyección" }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.rejected).toEqual(["transcription_context"]);
    expect(harness.writes).toEqual([]);
  });
});
