import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dir, "../../..");

function parseDependencyPairs(block: string): Record<string, string> {
  const deps: Record<string, string> = {};
  for (const match of block.matchAll(/"([^"]+)":\s*"([^"]+)"/g)) {
    deps[match[1]] = match[2];
  }
  return deps;
}

function readRootLockDependencies(): Record<string, string> {
  const lock = readFileSync(join(ROOT, "bun.lock"), "utf8");
  const rootWorkspace = lock.match(/"":\s*\{([\s\S]*?)\n {4}\},/);
  if (!rootWorkspace) return {};

  const dependenciesBlock = rootWorkspace[1].match(/"dependencies":\s*\{([\s\S]*?)\n {6}\},/);
  if (!dependenciesBlock) return {};

  return parseDependencyPairs(dependenciesBlock[1]);
}

function readRootPackageDependencies(): Record<string, string> {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  return pkg.dependencies ?? {};
}

describe("root lockfile consistency", () => {
  it("bun.lock's root workspace dependencies match package.json (no stale/phantom entries)", () => {
    expect(readRootLockDependencies()).toEqual(readRootPackageDependencies());
  });
});
