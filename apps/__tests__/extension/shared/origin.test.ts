import { describe, expect, it } from "bun:test";

import { toHostPermissionPattern } from "../../../extension/src/shared/origin";

describe("toHostPermissionPattern", () => {
  it("turns an https origin into a Chrome match pattern", () => {
    expect(toHostPermissionPattern("https://squaads.example.com")).toBe("https://squaads.example.com/*");
  });

  it("keeps the http scheme for self-hosted instances without TLS", () => {
    expect(toHostPermissionPattern("http://squaads.internal")).toBe("http://squaads.internal/*");
  });

  it("keeps a non-default port", () => {
    expect(toHostPermissionPattern("http://192.168.1.20:8080")).toBe("http://192.168.1.20:8080/*");
  });

  it("drops the default port so the pattern stays canonical", () => {
    expect(toHostPermissionPattern("https://squaads.example.com:443")).toBe("https://squaads.example.com/*");
  });

  it("reduces a URL carrying a path and query to its origin", () => {
    expect(toHostPermissionPattern("https://squaads.example.com/dashboard?tab=meetings")).toBe(
      "https://squaads.example.com/*",
    );
  });

  it("does not duplicate the separator when the base URL ends with a slash", () => {
    expect(toHostPermissionPattern("https://squaads.example.com/")).toBe("https://squaads.example.com/*");
  });

  it("returns an empty string for input Chrome would reject as a pattern", () => {
    expect(toHostPermissionPattern("")).toBe("");
    expect(toHostPermissionPattern("   ")).toBe("");
    expect(toHostPermissionPattern("not a url")).toBe("");
    expect(toHostPermissionPattern("squaads.example.com")).toBe("");
  });
});
