// ============================================================
// BODHI — Archive Phase-8-retired tables (X3, May 18)
// Run via: npx tsx packages/db/src/migrations/archive-phase8-tables.ts
//
// Phase 8 (2026-05-15) retired the Hive engine + workflow engine.
// The application code that wrote to workflow_runs, missions, and
// mission_tasks is gone. Tables left intact since May 15 carry
// historical data ("what Hive did in its life"). This migration
// renames them out of the live schema so:
//   1. They're not accidentally written to by future code
//   2. They're recoverable if someone wants the history
//   3. The live schema becomes leaner (substrate cleanup)
//
// Idempotent: checks existence before renaming.
// Suffix: _archived_phase8.
// ============================================================

import "dotenv/config";
import { getDb } from "../client.js";
import { sql } from "drizzle-orm";

const TABLES = ["workflow_runs", "missions", "mission_tasks"];

async function main() {
  const db = getDb();
  console.log("[archive-phase8-tables] Connecting to DB...");

  for (const t of TABLES) {
    const archived = `${t}_archived_phase8`;

    // Already archived?
    const archivedExists = await db.execute(sql.raw(`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = '${archived}'
      LIMIT 1
    `));
    if ((archivedExists as unknown as Array<unknown>).length > 0) {
      console.log(`[archive-phase8-tables] ${archived} already exists — skipping ${t}`);
      continue;
    }

    // Original still exists?
    const origExists = await db.execute(sql.raw(`
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = '${t}'
      LIMIT 1
    `));
    if ((origExists as unknown as Array<unknown>).length === 0) {
      console.log(`[archive-phase8-tables] ${t} does not exist — skipping`);
      continue;
    }

    // Row count for the log.
    const cnt = await db.execute(sql.raw(`SELECT COUNT(*)::int as n FROM ${t}`));
    const rowCount = (cnt as unknown as Array<{ n: number }>)[0]?.n ?? 0;

    await db.execute(sql.raw(`ALTER TABLE ${t} RENAME TO ${archived}`));
    console.log(`[archive-phase8-tables] ${t} → ${archived} (${rowCount} rows preserved)`);
  }

  console.log("[archive-phase8-tables] Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[archive-phase8-tables] FAILED:", err);
  process.exit(1);
});
