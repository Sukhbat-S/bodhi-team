// ============================================================
// BODHI — architect_inbox (Phase 33 C2, May 25, 2026)
// Run via: npx tsx packages/db/src/migrations/apply-architect-inbox.ts
//
// Failed subagent dispatches + budget halts + memory contradictions
// all post to this inbox. C3 oracle surfaces high-severity rows as
// Tier 2 suggestions at session-start. Dashboard /status badge shows
// undismissed count.
//
// Idempotent.
// ============================================================

import "dotenv/config";
import { getDb } from "../client.js";
import { sql } from "drizzle-orm";

async function main(): Promise<void> {
  const db = getDb();
  console.log("[apply-architect-inbox] Connecting...");

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS architect_inbox (
      id TEXT PRIMARY KEY,
      severity TEXT NOT NULL,
      kind TEXT NOT NULL,
      summary TEXT NOT NULL,
      context_hash TEXT,
      related_dispatch_id TEXT,
      posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      dismissed_at TIMESTAMPTZ
    );
  `));
  console.log("[apply-architect-inbox] table ensured");

  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS architect_inbox_pending_idx
      ON architect_inbox (severity, posted_at DESC)
      WHERE dismissed_at IS NULL;
  `));
  console.log("[apply-architect-inbox] index ensured");

  await db.execute(sql.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'architect_inbox_severity_chk') THEN
        ALTER TABLE architect_inbox
          ADD CONSTRAINT architect_inbox_severity_chk
          CHECK (severity IN ('high', 'medium', 'low'));
      END IF;
    END $$;
  `));
  console.log("[apply-architect-inbox] severity CHECK ensured");

  console.log("[apply-architect-inbox] Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[apply-architect-inbox] FAILED:", err);
  process.exit(1);
});
