// ============================================================
// BODHI — agent_dispatches status state machine (Phase 33 A3, May 25, 2026)
// Run via: npx tsx packages/db/src/migrations/apply-agent-dispatches-status.ts
//
// Adds three columns to the existing agent_dispatches table:
//   - status text NOT NULL DEFAULT 'reported'
//   - verified_at timestamptz
//   - verified_by text
//
// Existing rows backfill to status='verified' (architect's implicit
// prior approval). After backfill, DEFAULT is set to 'reported' so
// new dispatches enter the state machine at the right node.
//
// Idempotent — re-running adds nothing.
// ============================================================

import "dotenv/config";
import { getDb } from "../client.js";
import { sql } from "drizzle-orm";

async function main(): Promise<void> {
  const db = getDb();
  console.log("[apply-agent-dispatches-status] Connecting...");

  // Step 1: add columns if absent. Initial DEFAULT 'verified' for backfill.
  await db.execute(sql.raw(`
    ALTER TABLE agent_dispatches
      ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'verified',
      ADD COLUMN IF NOT EXISTS verified_at timestamptz,
      ADD COLUMN IF NOT EXISTS verified_by text;
  `));
  console.log("[apply-agent-dispatches-status] columns added");

  // Step 2: switch DEFAULT to 'reported' so new dispatches enter at
  // the right state. Existing rows keep 'verified' from the backfill default.
  await db.execute(sql.raw(`
    ALTER TABLE agent_dispatches
      ALTER COLUMN status SET DEFAULT 'reported';
  `));
  console.log("[apply-agent-dispatches-status] default set to 'reported'");

  // Step 3: index for fast "all reported dispatches awaiting verify" queries.
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS agent_dispatches_pending_verify_idx
      ON agent_dispatches (agent_name, dispatched_at DESC)
      WHERE status = 'reported' AND archived_at IS NULL;
  `));
  console.log("[apply-agent-dispatches-status] partial index ensured");

  // Step 4: CHECK constraint for valid status values.
  await db.execute(sql.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'agent_dispatches_status_chk'
      ) THEN
        ALTER TABLE agent_dispatches
          ADD CONSTRAINT agent_dispatches_status_chk
          CHECK (status IN ('reported', 'verified', 'archived', 'failed'));
      END IF;
    END $$;
  `));
  console.log("[apply-agent-dispatches-status] CHECK constraint ensured");

  console.log("[apply-agent-dispatches-status] Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[apply-agent-dispatches-status] FAILED:", err);
  process.exit(1);
});
