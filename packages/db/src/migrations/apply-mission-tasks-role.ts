// ============================================================
// BODHI — Mission task role column
// Run via: npx tsx packages/db/src/migrations/apply-mission-tasks-role.ts
//
// Idempotent. Adds a `role` text column to mission_tasks and
// backfills existing rows from the title prefix that Commander
// already assigns (e.g. "[scout] ...", "[builder] ..."). Unlocks
// per-role analytics on the agent-portfolio Tier 2 (Hive) surface.
// ============================================================

import "dotenv/config";
import { getDb } from "../client.js";
import { sql } from "drizzle-orm";

const ADD_COLUMN_DDL = `
ALTER TABLE mission_tasks
  ADD COLUMN IF NOT EXISTS role text;
`;

const BACKFILL_SQL = `
UPDATE mission_tasks
SET role = LOWER(SUBSTRING(title FROM '^\\[([^\\]]+)\\]'))
WHERE role IS NULL
  AND title ~ '^\\[[^\\]]+\\]';
`;

const INDEX_DDL = `
CREATE INDEX IF NOT EXISTS mission_tasks_role_idx ON mission_tasks (role)
  WHERE role IS NOT NULL;
`;

async function main() {
  const db = getDb();
  console.log("[mission-tasks-role] Connecting to DB...");

  await db.execute(sql.raw(ADD_COLUMN_DDL));
  console.log("[mission-tasks-role] role column ensured");

  const before = await db.execute(sql.raw("SELECT COUNT(*) as c FROM mission_tasks WHERE role IS NULL;"));
  console.log("[mission-tasks-role] rows with null role (pre-backfill):", before);

  await db.execute(sql.raw(BACKFILL_SQL));

  const after = await db.execute(sql.raw("SELECT COUNT(*) as c FROM mission_tasks WHERE role IS NULL;"));
  console.log("[mission-tasks-role] rows with null role (post-backfill):", after);

  const dist = await db.execute(sql.raw(`
    SELECT role, COUNT(*) as n
    FROM mission_tasks
    GROUP BY role
    ORDER BY n DESC;
  `));
  console.log("[mission-tasks-role] role distribution:", dist);

  await db.execute(sql.raw(INDEX_DDL));
  console.log("[mission-tasks-role] index ensured");

  console.log("[mission-tasks-role] Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[mission-tasks-role] FAILED:", err);
  process.exit(1);
});
