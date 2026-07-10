import { describe, expect, it } from "bun:test";

import { isAuthorizedToken, isPublicPagePath } from "../../../web/src/lib/pageAuthGuard";

describe("isAuthorizedToken", () => {
  it("returns false for null or undefined tokens", () => {
    expect(isAuthorizedToken(null)).toBe(false);
    expect(isAuthorizedToken(undefined)).toBe(false);
  });

  it("returns false for a token without a role", () => {
    expect(isAuthorizedToken({})).toBe(false);
    expect(isAuthorizedToken({ role: undefined })).toBe(false);
  });

  it("returns true for a token with role admin or member", () => {
    expect(isAuthorizedToken({ role: "admin" })).toBe(true);
    expect(isAuthorizedToken({ role: "member" })).toBe(true);
  });
});

describe("isPublicPagePath", () => {
  it("returns true for /login and /share/:token", () => {
    expect(isPublicPagePath("/login")).toBe(true);
    expect(isPublicPagePath("/share/algo")).toBe(true);
  });

  it("returns false for protected dashboard paths", () => {
    expect(isPublicPagePath("/")).toBe(false);
    expect(isPublicPagePath("/settings")).toBe(false);
    expect(isPublicPagePath("/downloads/x")).toBe(false);
  });
});
