// ============================================================
// BODHI — One-shot migration for the plans table
// Run via: npx tsx packages/db/src/migrations/apply-plans.ts
//
// Idempotent + additive-only (CREATE TABLE IF NOT EXISTS). Backs the
// interactive HTML await-plan artifact surface (dashboard /plan/:id).
//
// WS2 (orchestrator-reliability arc), Jun 8, 2026.
// ============================================================

import "dotenv/config";
import { getDb } from "../client.js";
import { sql } from "drizzle-orm";

const TABLE_DDL = `
CREATE TABLE IF NOT EXISTS plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  html_content text NOT NULL,
  options jsonb,
  action_class text,
  related_dispatch_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  feedback_json jsonb,
  resolved_at timestamptz
);
`;

async function main() {
  const db = getDb();
  console.log("[plans-migration] Connecting to DB...");
  await db.execute(sql.raw(TABLE_DDL));
  console.log("[plans-migration] plans table ensured");
  console.log("[plans-migration] Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[plans-migration] FAILED:", err);
  process.exit(1);
});
