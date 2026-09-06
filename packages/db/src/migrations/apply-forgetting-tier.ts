// ============================================================
// BODHI — Forgetting tier (Phase S1, May 18)
// Run via: npx tsx packages/db/src/migrations/apply-forgetting-tier.ts
//
// SUBSTRATE.md §9 #3: "instrument recall_score + cold-tier
// retirement after 90 days no recall. Closes the hoarding endgame."
//
// Adds recall_count + last_recalled_at columns to memories. Daily
// cron retires cold-tier memories: age > 90d AND recall_count = 0
// AND importance < 0.7 AND no do-not-forget tag.
//
// Idempotent.
// ============================================================

import "dotenv/config";
import { getDb } from "../client.js";
import { sql } from "drizzle-orm";

const ADD_COLUMNS_DDL = `
ALTER TABLE memories
  ADD COLUMN IF NOT EXISTS recall_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_recalled_at timestamptz,
  ADD COLUMN IF NOT EXISTS forgotten_at timestamptz;
`;

// Backfill recall_count from existing access_count if present.
// access_count was tracked earlier — preserves history.
const BACKFILL_DDL = `
UPDATE memories
SET recall_count = COALESCE(access_count, 0)
WHERE recall_count = 0;
`;

const INDEX_COLD_DDL = `
CREATE INDEX IF NOT EXISTS memories_cold_tier_idx
  ON memories (created_at, recall_count, importance)
  WHERE forgotten_at IS NULL;
`;

async function main() {
  const db = getDb();
  console.log("[apply-forgetting-tier] Connecting to DB...");

  await db.execute(sql.raw(ADD_COLUMNS_DDL));
  console.log("[apply-forgetting-tier] recall_count + last_recalled_at + forgotten_at columns ensured");

  await db.execute(sql.raw(BACKFILL_DDL));
  console.log("[apply-forgetting-tier] backfilled recall_count from access_count");

  await db.execute(sql.raw(INDEX_COLD_DDL));
  console.log("[apply-forgetting-tier] cold-tier index ensured");

  console.log("[apply-forgetting-tier] Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[apply-forgetting-tier] FAILED:", err);
  process.exit(1);
});
