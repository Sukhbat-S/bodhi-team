// ============================================================
// BODHI — One-shot migration for the system_events table
// Run via: npx tsx packages/db/src/migrations/apply-system-events.ts
//
// Idempotent: safe to run multiple times. Only creates the enum,
// table, and indexes if they don't already exist. Closes the
// audit's "5-surface puzzle" finding (Apr 26 C#5).
// ============================================================

import "dotenv/config";
import { getDb } from "../client.js";
import { sql } from "drizzle-orm";

const SEVERITY_ENUM_DDL = `
DO $$ BEGIN
  CREATE TYPE system_event_severity AS ENUM ('info', 'warn', 'error');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
`;

const TABLE_DDL = `
CREATE TABLE IF NOT EXISTS system_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ts timestamptz NOT NULL DEFAULT now(),
  kind text NOT NULL,
  summary text NOT NULL,
  severity system_event_severity NOT NULL DEFAULT 'info',
  payload jsonb,
  acknowledged_at timestamptz
);
`;

const INDEX_DDL = `
CREATE INDEX IF NOT EXISTS system_events_ts_kind_idx ON system_events (ts DESC, kind);
CREATE INDEX IF NOT EXISTS system_events_unacked_idx ON system_events (ts DESC) WHERE acknowledged_at IS NULL;
`;

async function main() {
  const db = getDb();
  console.log("[system-events-migration] Connecting to DB...");
  await db.execute(sql.raw(SEVERITY_ENUM_DDL));
  console.log("[system-events-migration] severity enum ensured");
  await db.execute(sql.raw(TABLE_DDL));
  console.log("[system-events-migration] system_events table ensured");
  await db.execute(sql.raw(INDEX_DDL));
  console.log("[system-events-migration] indexes ensured");
  console.log("[system-events-migration] Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[system-events-migration] FAILED:", err);
  process.exit(1);
});
