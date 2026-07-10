import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dir, "../../..");
const MIGRATION_PATH = join(ROOT, "drizzle", "0004_add_authorized_accounts.sql");

function readMigration(): string {
  return readFileSync(MIGRATION_PATH, "utf8");
}

describe("authorized_accounts migration", () => {
  it("creates the authorized_accounts table with a unique email and a member default role", () => {
    const sql = readMigration();
    expect(sql).toMatch(/CREATE TABLE\s+"authorized_accounts"/);
    expect(sql).toMatch(/"email" text NOT NULL/);
    expect(sql).toMatch(/UNIQUE\("email"\)/);
    expect(sql).toMatch(/"role" "authorized_account_role" DEFAULT 'member' NOT NULL/);
    expect(sql).toMatch(/"is_active" boolean DEFAULT true NOT NULL/);
  });

  it("backfills every existing user email as an active member, without duplicating on re-run", () => {
    const sql = readMigration();
    expect(sql).toMatch(/INSERT INTO "authorized_accounts"/);
    expect(sql).toMatch(/FROM "users"/);
    expect(sql).toMatch(/'member'/);
    expect(sql).toMatch(/ON CONFLICT \("email"\) DO NOTHING/);
  });
});
