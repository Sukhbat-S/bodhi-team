// ============================================================
// BODHI — One-shot migration for the concierge_state table
// Run via: npx tsx packages/db/src/migrations/apply-concierge.ts
//
// Idempotent: safe to run multiple times. Creates the singleton-
// per-channel concierge_state table the head agent uses to track
// its working set (handledSilently, activeWatches, taskQueue,
// notesForDigest). Conversation history reuses conversation_threads
// + conversation_turns; long-term memory reuses memories. This
// table only persists what doesn't fit elsewhere.
// ============================================================

import "dotenv/config";
import { getDb } from "../client.js";
import { sql } from "drizzle-orm";

// channel enum already exists from conversations migration; safe to assume it.
// thread_id references conversation_threads(id) which already exists.

const TABLE_DDL = `
CREATE TABLE IF NOT EXISTS concierge_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel channel NOT NULL,
  thread_id uuid REFERENCES conversation_threads(id) ON DELETE SET NULL,
  working_set jsonb NOT NULL DEFAULT '{
    "handledSilently": [],
    "activeWatches": [],
    "taskQueue": [],
    "notesForDigest": []
  }'::jsonb,
  last_active_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

const INDEX_DDL = `
CREATE UNIQUE INDEX IF NOT EXISTS concierge_state_channel_unique ON concierge_state (channel);
`;

async function main() {
  const db = getDb();
  console.log("[concierge-migration] Connecting to DB...");
  await db.execute(sql.raw(TABLE_DDL));
  console.log("[concierge-migration] concierge_state table ensured");
  await db.execute(sql.raw(INDEX_DDL));
  console.log("[concierge-migration] unique index ensured");
  console.log("[concierge-migration] Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[concierge-migration] FAILED:", err);
  process.exit(1);
});
