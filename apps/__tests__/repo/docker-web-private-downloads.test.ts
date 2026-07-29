import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../../..");
const EXTENSION_ZIP = "apps/web/private-downloads/squaads-extension-internal.zip";

describe("Dockerfile.web private downloads contract", () => {
  it("ships the versioned extension ZIP at a path resolved by the runtime route", () => {
    const dockerfile = readFileSync(join(ROOT, "Dockerfile.web"), "utf8");

    expect(existsSync(join(ROOT, EXTENSION_ZIP))).toBe(true);
    expect(dockerfile).toContain(
      "COPY --from=builder /app/apps/web/private-downloads ./apps/web/private-downloads",
    );
  });
});
