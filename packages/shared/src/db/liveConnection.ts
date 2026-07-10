import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm/sql";
import { Pool } from "pg";

export { sql };

/**
 * Raw Drizzle connection factory, independent from `./index.ts`'s app-wide
 * lazy client and from `./schema.ts`. Tests that need a real (unmocked,
 * unproxied) Postgres connection must go through this file instead of
 * `@meeting-bot/shared/db` or `@meeting-bot/shared/db/schema` — those two
 * specifiers (plus bare `"drizzle-orm"`) are globally overridden by
 * `mock.module()` in repository tests, and Bun's mock registry is shared for
 * the whole `bun test` process (see apps/__tests__/helpers/dbSchemaMock.ts).
 */
export function createLiveConnection(connectionString: string) {
  const pool = new Pool({ connectionString });
  return { pool, db: drizzle(pool) };
}
