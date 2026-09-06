// ============================================================
// BODHI — Additive migration: plans.proposed_by
// Run via: npx tsx packages/db/src/migrations/apply-plans-proposed-by.ts
//
// Idempotent + additive-only (ADD COLUMN IF NOT EXISTS). Backs the §11
// provenance strip on the await-plan surface — the orchestrator stamps
// who/what authored the plan (e.g. "BODHI orchestrator · Opus 4.8").
// Existing rows get NULL; the dashboard renders a fallback for those.
//
// WS2 (orchestrator-reliability arc), Jun 8, 2026.
// ============================================================

import "dotenv/config";
import { getDb } from "../client.js";
import { sql } from "drizzle-orm";

const COLUMN_DDL = `
ALTER TABLE plans ADD COLUMN IF NOT EXISTS proposed_by text;
`;

async function main() {
  const db = getDb();
  console.log("[plans-proposed-by-migration] Connecting to DB...");
  await db.execute(sql.raw(COLUMN_DDL));
  console.log("[plans-proposed-by-migration] plans.proposed_by ensured");
  console.log("[plans-proposed-by-migration] Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[plans-proposed-by-migration] FAILED:", err);
  process.exit(1);
});
