// ============================================================
// BODHI — Token attribution + conversation_turns hot-path index
// Run via: npx tsx packages/db/src/migrations/apply-token-attribution-and-index.ts
//
// Idempotent: safe to run multiple times.
//
// Changes:
//  1. bridge_tasks gets a `model_used` text column so Bridge subprocess
//     telemetry can be model-attributed in /api/tokens/summary instead of
//     defaulting all bridge tasks to Opus pricing.
//  2. conversation_turns gets a compound (thread_id, created_at DESC)
//     index — getTurns() and the token-summary range scans both order
//     by created_at within a thread; this prevents seq scans as the
//     table grows past ~100K rows.
// ============================================================

import "dotenv/config";
import { getDb } from "../client.js";
import { sql } from "drizzle-orm";

const ADD_MODEL_USED_DDL = `
ALTER TABLE bridge_tasks
  ADD COLUMN IF NOT EXISTS model_used text;
`;

const CONVERSATION_TURNS_INDEX_DDL = `
CREATE INDEX IF NOT EXISTS conversation_turns_thread_created_idx
  ON conversation_turns (thread_id, created_at DESC);
`;

async function main() {
  const db = getDb();
  console.log("[token-attribution-migration] Connecting to DB...");
  await db.execute(sql.raw(ADD_MODEL_USED_DDL));
  console.log("[token-attribution-migration] bridge_tasks.model_used ensured");
  await db.execute(sql.raw(CONVERSATION_TURNS_INDEX_DDL));
  console.log("[token-attribution-migration] conversation_turns_thread_created_idx ensured");
  console.log("[token-attribution-migration] Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[token-attribution-migration] FAILED:", err);
  process.exit(1);
});
