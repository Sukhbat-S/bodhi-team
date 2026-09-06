// ============================================================
// BODHI — Actor attribution: set_by on shared-state writes
// Run via: npx tsx scripts/verified-migrate.ts \
//   packages/db/src/migrations/apply-set-by-actor-attribution.ts
//
// Additive + idempotent. Adds a nullable `set_by text` column to trust tiers.
//
// set_by records WHO drove the write. Vocabulary (documented in the schema):
//   'architect' | 'agent:<8-hex-session>' | 'probe:<purpose>'. Nullable so
// legacy rows stay valid.
//
// Wave 1 of plan-sync-coherence-jul08.md. Jul 8, 2026.
// ============================================================

import "dotenv/config";
import { getDb } from "../client.js";
import { sql } from "drizzle-orm";

const DDL = `
ALTER TABLE trust_tiers ADD COLUMN IF NOT EXISTS set_by text;
`;

async function main() {
  const db = getDb();
  console.log("[set-by-migration] Connecting to DB...");
  await db.execute(sql.raw(DDL));
  console.log("[set-by-migration] set_by column ensured on trust_tiers");
  console.log("[set-by-migration] Done.");
  // Close the process so the pg pool doesn't keep the verified-migrate child
  // alive past the RUN-gate timeout (matches the apply-trust-tiers precedent).
  process.exit(0);
}

main().catch((err) => {
  console.error("[set-by-migration] FAILED:", err);
  process.exit(1);
});
