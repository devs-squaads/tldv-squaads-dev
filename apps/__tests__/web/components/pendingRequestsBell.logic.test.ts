import { describe, expect, it } from "bun:test";

import { shouldRenderPendingBell } from "../../../web/src/components/pendingRequestsBell.logic";

describe("shouldRenderPendingBell", () => {
  it("returns true only for the admin role", () => {
    expect(shouldRenderPendingBell("admin")).toBe(true);
  });

  it("returns false for member or missing role", () => {
    expect(shouldRenderPendingBell("member")).toBe(false);
    expect(shouldRenderPendingBell(undefined)).toBe(false);
    expect(shouldRenderPendingBell(null)).toBe(false);
  });
});
