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
  fileExists?: boolean;
}

function setupHarness(options: HarnessOptions = {}) {
  const writeCalls: Array<{ path: string; content: string }> = [];
  const unlinkCalls: string[] = [];
  const session = options.session === undefined ? { id: "user-1", email: "user@squaads.com" } : options.session;

  moduleMock.module("next-auth", () => ({
    getServerSession: async () => (session ? { user: session } : null),
  }));

  moduleMock.module("@/auth", () => ({ authOptions: {} }));

  moduleMock.module("fs", () => ({
    default: {
      existsSync: () => options.fileExists ?? false,
      mkdirSync: () => undefined,
      readFileSync: () =>
        JSON.stringify({ type: "service_account", project_id: "proj", client_email: "sa@proj.iam" }),
      writeFileSync: (filePath: string, content: string) => {
        writeCalls.push({ path: filePath, content });
      },
      unlinkSync: (filePath: string) => {
        unlinkCalls.push(filePath);
      },
    },
    existsSync: () => options.fileExists ?? false,
    mkdirSync: () => undefined,
    readFileSync: () =>
      JSON.stringify({ type: "service_account", project_id: "proj", client_email: "sa@proj.iam" }),
    writeFileSync: (filePath: string, content: string) => {
      writeCalls.push({ path: filePath, content });
    },
    unlinkSync: (filePath: string) => {
      unlinkCalls.push(filePath);
    },
  }));

  return {
    writeCalls,
    unlinkCalls,
    importRoute: () =>
      import(`../../../web/src/app/api/settings/google-credentials/route.ts?test=${Date.now()}`),
  };
}

const VALID_CREDENTIALS = JSON.stringify({
  type: "service_account",
  project_id: "proj",
  private_key: "-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----\n",
});

function postCredentials(body: unknown) {
  return new Request("http://localhost/api/settings/google-credentials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("google-credentials route authorization (spec 015)", () => {
  it("returns 401 on GET for an anonymous request", async () => {
    const harness = setupHarness({ session: null });
    const { GET } = await harness.importRoute();

    const res = await GET();

    expect(res.status).toBe(401);
  });

  it("returns 401 on POST for an anonymous request and writes nothing to disk", async () => {
    const harness = setupHarness({ session: null });
    const { POST } = await harness.importRoute();

    const res = await POST(postCredentials({ json: VALID_CREDENTIALS }));

    expect(res.status).toBe(401);
    expect(harness.writeCalls).toEqual([]);
  });

  it("returns 401 on DELETE for an anonymous request and deletes nothing", async () => {
    const harness = setupHarness({ session: null, fileExists: true });
    const { DELETE } = await harness.importRoute();

    const res = await DELETE();

    expect(res.status).toBe(401);
    expect(harness.unlinkCalls).toEqual([]);
  });

  it("still lets an authenticated user save the credentials", async () => {
    const harness = setupHarness();
    const { POST } = await harness.importRoute();

    const res = await POST(postCredentials({ json: VALID_CREDENTIALS }));

    expect(res.status).toBe(200);
    expect(harness.writeCalls).toHaveLength(1);
  });

  it("still lets an authenticated user read the preview", async () => {
    const harness = setupHarness({ fileExists: true });
    const { GET } = await harness.importRoute();

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.exists).toBe(true);
  });

  it("still lets an authenticated user delete the credentials", async () => {
    const harness = setupHarness({ fileExists: true });
    const { DELETE } = await harness.importRoute();

    const res = await DELETE();

    expect(res.status).toBe(200);
    expect(harness.unlinkCalls).toHaveLength(1);
  });
});
