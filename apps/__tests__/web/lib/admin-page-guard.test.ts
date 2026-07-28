import { describe, expect, it } from "bun:test";

import { resolveAdminPageRedirect } from "../../../web/src/lib/adminPageGuard";

describe("resolveAdminPageRedirect", () => {
  it("redirects to /login when there is no session", () => {
    expect(resolveAdminPageRedirect(null)).toBe("/login");
    expect(resolveAdminPageRedirect(undefined)).toBe("/login");
  });

  it("redirects to /login when the session has no user id", () => {
    expect(resolveAdminPageRedirect({ user: { role: "admin" } })).toBe("/login");
  });

  it("redirects to / when the caller is not an admin", () => {
    expect(resolveAdminPageRedirect({ user: { id: "user-1", role: "member" } })).toBe("/");
  });

  it("allows through when the caller is an admin", () => {
    expect(resolveAdminPageRedirect({ user: { id: "user-1", role: "admin" } })).toBeNull();
  });
});
