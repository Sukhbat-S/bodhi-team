// ============================================================
// BODHI — Additive migration: library_search_invocations.retrieved_chunk_ids
// Run via: npx tsx scripts/verified-migrate.ts packages/db/src/migrations/apply-library-invocations-retrieved-ids.ts
//
// Idempotent + additive-only (ADD COLUMN IF NOT EXISTS). Records WHICH
// chunks each library search served (not just how many) — unlocks
// per-source serving stats so curation can key off real retrieval
// instead of ingest-side presence. Existing rows get NULL.
//
// Wave C (library re-scope), Jun 10, 2026.
// ============================================================

import "dotenv/config";
import { getDb } from "../client.js";
import { sql } from "drizzle-orm";

const COLUMN_DDL = `
ALTER TABLE library_search_invocations ADD COLUMN IF NOT EXISTS retrieved_chunk_ids text[];
`;

async function main() {
  const db = getDb();
  console.log("[library-invocations-retrieved-ids-migration] Connecting to DB...");
  await db.execute(sql.raw(COLUMN_DDL));
  console.log("[library-invocations-retrieved-ids-migration] library_search_invocations.retrieved_chunk_ids ensured");
  console.log("[library-invocations-retrieved-ids-migration] Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[library-invocations-retrieved-ids-migration] FAILED:", err);
  process.exit(1);
});
