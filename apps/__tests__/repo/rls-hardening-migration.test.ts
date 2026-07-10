import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dir, "../../..");
const MIGRATION_PATH = join(ROOT, "drizzle", "0005_enable_rls.sql");

const RLS_TABLES = [
  "users",
  "authorized_accounts",
  "meetings",
  "settings",
  "meeting_shares",
  "meeting_share_access_logs",
  "chat_messages",
] as const;

function readMigration(): string {
  return readFileSync(MIGRATION_PATH, "utf8");
}

describe("RLS hardening migration", () => {
  it.each(RLS_TABLES)("enables row level security on %s exactly once", (table) => {
    const sql = readMigration();
    const pattern = new RegExp(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`, "g");
    const matches = sql.match(pattern) ?? [];
    expect(matches).toHaveLength(1);
  });

  it("touches exactly the 7 tables in scope, nothing else", () => {
    const sql = readMigration();
    const allEnableStatements = sql.match(/ALTER TABLE "[^"]+" ENABLE ROW LEVEL SECURITY;/g) ?? [];
    expect(allEnableStatements).toHaveLength(RLS_TABLES.length);
  });

  it("contains no destructive or policy statements", () => {
    const sql = readMigration();
    expect(sql).not.toMatch(/DROP\s/i);
    expect(sql).not.toMatch(/CREATE POLICY/i);
  });
});
