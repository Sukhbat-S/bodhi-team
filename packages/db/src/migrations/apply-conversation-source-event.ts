// ============================================================
// BODHI — Conversation source-event idempotency
// Run via: npx tsx packages/db/src/migrations/apply-conversation-source-event.ts
//
// Phase B1 (May 17, 2026). Adds source_event_id (text) +
// source_timestamp (timestamptz) columns to conversation_turns so
// the CLI transcript ingest can be idempotent on the JSONL line
// UUID. Partial unique index on source_event_id (where not null)
// makes re-runs safe — ON CONFLICT DO NOTHING semantics.
//
// Idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
// ============================================================

import "dotenv/config";
import { getDb } from "../client.js";
import { sql } from "drizzle-orm";

const ADD_COLUMNS_DDL = `
ALTER TABLE conversation_turns
  ADD COLUMN IF NOT EXISTS source_event_id text,
  ADD COLUMN IF NOT EXISTS source_timestamp timestamptz;
`;

// Partial unique index — only enforced when source_event_id is set.
// Telegram + web channels leave it null; CLI ingest writes it.
const INDEX_DDL = `
CREATE UNIQUE INDEX IF NOT EXISTS conversation_turns_source_event_id_idx
  ON conversation_turns (source_event_id)
  WHERE source_event_id IS NOT NULL;
`;

const SOURCE_TS_INDEX_DDL = `
CREATE INDEX IF NOT EXISTS conversation_turns_source_timestamp_idx
  ON conversation_turns (source_timestamp DESC)
  WHERE source_timestamp IS NOT NULL;
`;

async function main() {
  const db = getDb();
  console.log("[conversation-source-event] Connecting to DB...");

  await db.execute(sql.raw(ADD_COLUMNS_DDL));
  console.log("[conversation-source-event] columns ensured (source_event_id, source_timestamp)");

  await db.execute(sql.raw(INDEX_DDL));
  console.log("[conversation-source-event] unique partial index on source_event_id ensured");

  await db.execute(sql.raw(SOURCE_TS_INDEX_DDL));
  console.log("[conversation-source-event] index on source_timestamp ensured");

  console.log("[conversation-source-event] Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[conversation-source-event] FAILED:", err);
  process.exit(1);
});
