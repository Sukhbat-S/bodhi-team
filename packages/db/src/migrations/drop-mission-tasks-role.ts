// ============================================================
// BODHI — Drop mission_tasks.role column (Hive retirement cleanup)
// Run via: npx tsx packages/db/src/migrations/drop-mission-tasks-role.ts
//
// Phase O5 (May 18, 2026). The `role` column was added May 15
// (apply-mission-tasks-role.ts) for Hive role-aware analytics on
// the agent-portfolio Tier 2 surface. Hive itself was retired
// Phase 8 (May 15) the same day. The column is dead: no consumer
// reads it; no writer populates it post-Phase-8. Drop.
//
// Idempotent: ALTER TABLE ... DROP COLUMN IF EXISTS. Safe re-run.
// The mission_tasks TABLE itself is left intact (84 historical
// rows preserved as the "what Hive did" reference).
// ============================================================

import "dotenv/config";
import { getDb } from "../client.js";
import { sql } from "drizzle-orm";

const DROP_INDEX_DDL = `
DROP INDEX IF EXISTS mission_tasks_role_idx;
`;

const DROP_COLUMN_DDL = `
ALTER TABLE mission_tasks DROP COLUMN IF EXISTS role;
`;

async function main() {
  const db = getDb();
  console.log("[drop-mission-tasks-role] Connecting to DB...");

  await db.execute(sql.raw(DROP_INDEX_DDL));
  console.log("[drop-mission-tasks-role] mission_tasks_role_idx dropped (if existed)");

  await db.execute(sql.raw(DROP_COLUMN_DDL));
  console.log("[drop-mission-tasks-role] role column dropped (if existed)");

  console.log("[drop-mission-tasks-role] Done. mission_tasks table preserved as historical record of Hive activity.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[drop-mission-tasks-role] FAILED:", err);
  process.exit(1);
});
