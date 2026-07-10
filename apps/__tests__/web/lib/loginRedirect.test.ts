import { describe, expect, it } from "bun:test";

import { resolveLoginRedirect } from "../../../web/src/lib/loginRedirect";

describe("resolveLoginRedirect", () => {
  it("returns the callback url when it is a simple internal path", () => {
    expect(resolveLoginRedirect("/settings")).toBe("/settings");
  });

  it("falls back to / for null, empty, protocol-relative, or absolute urls", () => {
    expect(resolveLoginRedirect(null)).toBe("/");
    expect(resolveLoginRedirect("")).toBe("/");
    expect(resolveLoginRedirect("//evil.com")).toBe("/");
    expect(resolveLoginRedirect("https://evil.com")).toBe("/");
  });
});
