// ============================================================
// BODHI — Database Client (Drizzle + PostgreSQL)
// ============================================================

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

let db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let pgClient: ReturnType<typeof postgres> | null = null;

export function getDb(connectionString?: string) {
  if (db) return db;

  const url = connectionString || process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is required. Set it in .env or pass it directly."
    );
  }

  pgClient = postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    max_lifetime: 300,
    // Postgres-level statement timeout — prevents runaway queries from
    // holding pool connections forever. Synthesizer + drift scanner
    // should finish well under 30s.
    connection: {
      // Typed as string in postgres-js but sent as-is; Postgres accepts ms integers
      statement_timeout: 30_000,
    } as never,
  });

  db = drizzle(pgClient, { schema });
  return db;
}

/** Close the pool cleanly on shutdown — called from server's SIGTERM handler. */
export async function closeDb(): Promise<void> {
  if (pgClient) {
    try {
      await pgClient.end({ timeout: 5 });
    } catch {
      // best-effort — already closing, nothing to do
    }
    pgClient = null;
    db = null;
  }
}

export type Database = ReturnType<typeof getDb>;
