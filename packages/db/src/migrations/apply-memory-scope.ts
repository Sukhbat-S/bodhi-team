// ============================================================
// BODHI — Memory `scope` authority tier (§2.6, May 30, 2026)
// Run via:  npx tsx scripts/verified-migrate.ts \
//             packages/db/src/migrations/apply-memory-scope.ts
//
// AGENTS.md §2.6 ("memory is not foundation"): a confident decision-memory
// reads identically to a standing axiom to a fresh agent. This column adds
// an explicit, architect-assignable authority tier so retrieval can demote
// `archived` (stale/superseded) memories and promote `foundational` ones.
//
// Honest scope note (verified May 30): the constitutional docs
// (AGENTS/ARCHITECT/SUBSTRATE.md) are NOT rows in this table — they load via
// the knowledge provider BEFORE retrieval. So `scope` tiers the ~3,700
// EPISODIC memories among themselves; it does not rank doc-foundation vs
// memory. Paired with the assembly-time "[decided Nd ago]" marker
// (provider.ts), it makes the §2.6 disposition structural, not just prose.
//
// Additive + idempotent (enum guarded by duplicate_object; column by
// IF NOT EXISTS). Designed to pass scripts/verified-migrate.ts' 5-part gate.
// The row backfill is a SEPARATE, architect-approved UPDATE — it is
// non-additive and intentionally NOT part of this migration.
// ============================================================

import "dotenv/config";
import { getDb } from "../client.js";
import { sql } from "drizzle-orm";

const SCOPE_ENUM_DDL = `
DO $$ BEGIN
  CREATE TYPE memory_scope AS ENUM ('foundational', 'session-active', 'archived');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
`;

const ADD_COLUMN_DDL = `
ALTER TABLE memories
  ADD COLUMN IF NOT EXISTS scope memory_scope NOT NULL DEFAULT 'session-active';
`;

async function main() {
  const db = getDb();
  console.log("[apply-memory-scope] Connecting to DB...");

  await db.execute(sql.raw(SCOPE_ENUM_DDL));
  console.log("[apply-memory-scope] memory_scope enum ensured (foundational | session-active | archived)");

  await db.execute(sql.raw(ADD_COLUMN_DDL));
  console.log("[apply-memory-scope] scope column ensured (default 'session-active')");

  console.log("[apply-memory-scope] Done.");
  console.log("");
  console.log("Next: existing rows all default to 'session-active'. The authority backfill");
  console.log("(importance>=0.9|tag:canonical -> foundational; rejected|tag:superseded -> archived)");
  console.log("is a SEPARATE architect-approved UPDATE — not run here.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[apply-memory-scope] FAILED:", err);
  process.exit(1);
});
