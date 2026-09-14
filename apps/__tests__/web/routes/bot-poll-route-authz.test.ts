/// <reference types="bun" />

import { afterEach, describe, expect, it, mock } from "bun:test";

const moduleMock = mock as typeof mock & {
  module(specifier: string, factory: () => unknown): void;
  restore(): void;
};

const ORIGINAL_SECRET = process.env.API_ROUTE_SECRET;

afterEach(() => {
  moduleMock.restore();
  if (ORIGINAL_SECRET === undefined) {
    delete process.env.API_ROUTE_SECRET;
  } else {
    process.env.API_ROUTE_SECRET = ORIGINAL_SECRET;
  }
});

function setupHarness() {
  const pollCalls: number[] = [];

  moduleMock.module("@/services/workerRecoveryClient", () => ({
    requestWorkerAutoJoinPoll: async () => {
      pollCalls.push(Date.now());
      return { success: true, polled: 3, enqueued: 1 };
    },
  }));

  return {
    pollCalls,
    importRoute: () => import(`../../../web/src/app/api/bot/poll/route.ts?test=${Date.now()}`),
  };
}

describe("GET /api/bot/poll authorization (spec 015)", () => {
  it("returns 401 without a bearer secret and never reaches the worker", async () => {
    process.env.API_ROUTE_SECRET = "s3cret";
    const harness = setupHarness();
    const { GET } = await harness.importRoute();

    const res = await GET(new Request("http://localhost/api/bot/poll"));

    expect(res.status).toBe(401);
    expect(harness.pollCalls).toEqual([]);
  });

  it("returns 401 with a wrong bearer secret", async () => {
    process.env.API_ROUTE_SECRET = "s3cret";
    const harness = setupHarness();
    const { GET } = await harness.importRoute();

    const res = await GET(
      new Request("http://localhost/api/bot/poll", { headers: { Authorization: "Bearer nope" } }),
    );

    expect(res.status).toBe(401);
    expect(harness.pollCalls).toEqual([]);
  });

  it("still triggers the poll for a cron carrying the shared secret", async () => {
    process.env.API_ROUTE_SECRET = "s3cret";
    const harness = setupHarness();
    const { GET } = await harness.importRoute();

    const res = await GET(
      new Request("http://localhost/api/bot/poll", { headers: { Authorization: "Bearer s3cret" } }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(harness.pollCalls).toHaveLength(1);
    expect(body.enqueued).toBe(1);
  });
});
