// ============================================================
// BODHI — One-shot migration for the parked_items table
// Run via: npx tsx scripts/verified-migrate.ts packages/db/src/migrations/apply-parked-items.ts
//
// Idempotent, additive-only. Creates parked_items (the parking system's
// store — self-curating attention with resurface triggers) plus its two
// lookup indexes. DDL mirrors packages/db/src/schema/parked-items.ts:
// 16 columns, 3 CHECK constraints, 2 indexes. No seeds.
//
// Parking system Wave 1 — spec 776db7f, Jul 5, 2026.
// ============================================================

import "dotenv/config";
import { getDb } from "../client.js";
import { sql } from "drizzle-orm";

const TABLE_DDL = `
CREATE TABLE IF NOT EXISTS parked_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  title text NOT NULL,
  detail text NOT NULL DEFAULT '',
  origin_kind text NOT NULL DEFAULT 'free',
  origin_ref text,
  trigger jsonb NOT NULL,
  auto_close jsonb,
  review_by timestamptz NOT NULL DEFAULT now() + interval '30 days',
  status text NOT NULL DEFAULT 'parked',
  closed_reason text,
  resurfaced_reason text,
  parked_at timestamptz NOT NULL DEFAULT now(),
  resurfaced_at timestamptz,
  closed_at timestamptz,
  surfaced_close_at timestamptz,
  created_by text,
  CONSTRAINT parked_items_status_chk CHECK (status IN ('parked','resurfaced','closed')),
  CONSTRAINT parked_items_origin_chk CHECK (origin_kind IN ('memory','cron','dispatch','inbox','free')),
  CONSTRAINT parked_items_closed_reason_chk CHECK (closed_reason IS NULL OR closed_reason IN ('done','moot','expired_review'))
);
`;

const STATUS_IDX_DDL = `
CREATE INDEX IF NOT EXISTS parked_items_status_idx ON parked_items (status);
`;

const ORIGIN_IDX_DDL = `
CREATE INDEX IF NOT EXISTS parked_items_origin_idx ON parked_items (origin_kind, origin_ref);
`;

async function main() {
  const db = getDb();
  console.log("[parked-items-migration] Connecting to DB...");
  await db.execute(sql.raw(TABLE_DDL));
  console.log("[parked-items-migration] parked_items table ensured");
  await db.execute(sql.raw(STATUS_IDX_DDL));
  await db.execute(sql.raw(ORIGIN_IDX_DDL));
  console.log("[parked-items-migration] indexes ensured");
  console.log("[parked-items-migration] Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[parked-items-migration] FAILED:", err);
  process.exit(1);
});
