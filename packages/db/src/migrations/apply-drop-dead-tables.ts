// ============================================================
// BODHI — Drop dead tables (Decision sweep, May 19, 2026)
// Run via: npx tsx packages/db/src/migrations/apply-drop-dead-tables.ts
//
// Architect-decision sweep, post-Mission-4 surfacing. Each of these
// has 0 (or 1 test) rows and no live write path:
//
//   - bridge_tasks                    0 rows ever; Bridge-task UI surface
//                                     never shipped
//   - push_subscriptions              0 rows; PWA Web Push never activated
//                                     (VAPID env vars stay for if/when ships)
//   - trades                          1 test row; crypto trading scoped out
//                                     per project_solo_income_may03
//   - workflow_runs_archived_phase8   0 rows; Phase 8 Hive retirement remnant
//
// Idempotent. DROP TABLE IF EXISTS.
// ============================================================

import "dotenv/config";
import { getDb } from "../client.js";
import { sql } from "drizzle-orm";

const DDL = [
  `DROP TABLE IF EXISTS bridge_tasks CASCADE;`,
  `DROP TABLE IF EXISTS push_subscriptions CASCADE;`,
  `DROP TABLE IF EXISTS trades CASCADE;`,
  `DROP TABLE IF EXISTS workflow_runs_archived_phase8 CASCADE;`,
];

async function main() {
  const db = getDb();
  console.log("[apply-drop-dead-tables] Connecting...");

  for (const stmt of DDL) {
    await db.execute(sql.raw(stmt));
    console.log(`[apply-drop-dead-tables] ${stmt}`);
  }

  console.log("[apply-drop-dead-tables] Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[apply-drop-dead-tables] FAILED:", err);
  process.exit(1);
});
