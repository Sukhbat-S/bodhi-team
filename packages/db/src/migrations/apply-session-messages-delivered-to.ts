// ============================================================
// BODHI — Additive migration: session_messages broadcast delivery tracking
// Run via: npx tsx scripts/verified-migrate.ts packages/db/src/migrations/apply-session-messages-delivered-to.ts
//
// Phase 2b of the cross-session coordination build. Fixes the broadcast-ack
// flaw: a to=null broadcast consumed by the FIRST drainer's ack
// (acknowledged=true) became invisible to every OTHER pane's unacked poll.
// Per-recipient delivery tracking lets each pane mark itself delivered without
// hiding the broadcast from the others:
//   - delivered_to    jsonb array of session ids that have drained this row
//                      (default '[]'); broadcasts stay unacked-for-S until S
//                      appears here. TARGETED messages keep using acknowledged.
//
// Idempotent + additive-only (ADD COLUMN IF NOT EXISTS). Designed to pass
// scripts/verified-migrate.ts' additive gate. No backfill, no DROP, no
// ALTER TYPE, no RENAME. Server routes + reaper land alongside this.
// ============================================================

import "dotenv/config";
import { getDb } from "../client.js";
import { sql } from "drizzle-orm";

const COLUMNS_DDL = `
ALTER TABLE session_messages ADD COLUMN IF NOT EXISTS delivered_to jsonb NOT NULL DEFAULT '[]'::jsonb;
`;

async function main() {
  const db = getDb();
  console.log("[session-messages-delivered-to-migration] Connecting to DB...");
  await db.execute(sql.raw(COLUMNS_DDL));
  console.log("[session-messages-delivered-to-migration] column ensured: delivered_to");
  console.log("[session-messages-delivered-to-migration] Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[session-messages-delivered-to-migration] FAILED:", err);
  process.exit(1);
});
