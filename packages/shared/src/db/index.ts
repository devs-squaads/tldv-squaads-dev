import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import "dotenv/config";

function getConnectionString(): string {
  const connectionString = process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5432/meeting_bot";

  if (!connectionString.startsWith("postgres://") && !connectionString.startsWith("postgresql://")) {
    throw new Error("DATABASE_URL must be a PostgreSQL connection string.");
  }

  return connectionString;
}

let _client: Pool | undefined;
let _db: ReturnType<typeof drizzle<typeof schema>> | undefined;

function getClient(): Pool {
  if (!_client) {
    const connectionString = getConnectionString();
    _client = new Pool({
      connectionString,
      ssl: connectionString.includes("supabase.co") ? { rejectUnauthorized: false } : undefined,
    });
  }
  return _client;
}

export const client = new Proxy({} as Pool, {
  get(_target, prop) {
    return (getClient() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop) {
    if (!_db) {
      _db = drizzle(getClient(), { schema });
    }
    return (_db as unknown as Record<string | symbol, unknown>)[prop];
  },
});
