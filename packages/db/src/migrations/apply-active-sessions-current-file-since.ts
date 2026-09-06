// ============================================================
// BODHI — Additive migration: active_sessions.current_file_since
// Run via: npx tsx scripts/verified-migrate.ts packages/db/src/migrations/apply-active-sessions-current-file-since.ts
//
// Phase 2a of the cross-session coordination build. Adds a claim-timestamp
// column to active_sessions so first-claim-wins ordering has a stable key:
//   - current_file_since  timestamptz (nullable; legacy rows get NULL)
//
// Set to now() by the ping endpoint whenever current_file transitions to a new
// value. The claim-overlap resolver orders contenders by (current_file_since, id)
// ascending — the earliest holder wins, losers get a targeted yield signal.
//
// Idempotent + additive-only (ADD COLUMN IF NOT EXISTS). Designed to pass
// scripts/verified-migrate.ts' additive gate. No backfill, no DROP, no
// ALTER TYPE, no RENAME.
// ============================================================

import "dotenv/config";
import { getDb } from "../client.js";
import { sql } from "drizzle-orm";

const COLUMNS_DDL = `
ALTER TABLE active_sessions ADD COLUMN IF NOT EXISTS current_file_since timestamptz;
`;

async function main() {
  const db = getDb();
  console.log("[active-sessions-current-file-since-migration] Connecting to DB...");
  await db.execute(sql.raw(COLUMNS_DDL));
  console.log("[active-sessions-current-file-since-migration] column ensured: current_file_since");
  console.log("[active-sessions-current-file-since-migration] Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[active-sessions-current-file-since-migration] FAILED:", err);
  process.exit(1);
});
