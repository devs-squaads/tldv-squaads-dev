import { afterEach, describe, expect, it, mock } from "bun:test";
import { connectExtension } from "../../../extension/src/background/api-client";

const originalFetch = globalThis.fetch;

describe("extension api client", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.restore();
  });

  it("shows the original origin mismatch guidance for 403 connect errors", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response("origin mismatch", {
          status: 403,
          headers: { "Content-Type": "text/plain" },
        }),
      ),
    ) as typeof fetch;

    await expect(connectExtension("https://app.squaads.test", "token-123")).rejects.toThrow(
      "Wrong site for this token. Open the same Squaads dashboard tab where you generated it and try again.",
    );
  });

  it("keeps the generic forbidden message for other 403 responses", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response("forbidden", {
          status: 403,
          headers: { "Content-Type": "text/plain" },
        }),
      ),
    ) as typeof fetch;

    await expect(connectExtension("https://app.squaads.test", "token-123")).rejects.toThrow(
      "Forbidden by server.",
    );
  });
});
