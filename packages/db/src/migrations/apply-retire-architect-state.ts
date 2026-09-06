// Retire the obsolete architect bandwidth-mode substrate.
// Explicitly approved on 2026-08-24 after its owner-facing control surface and
// live consumers had already been removed. Idempotent and intentionally scoped
// to the two retired tables.

import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../client.js";

async function main() {
  const db = getDb();
  await db.execute(sql.raw("DROP TABLE IF EXISTS architect_state_history CASCADE;"));
  await db.execute(sql.raw("DROP TABLE IF EXISTS architect_state CASCADE;"));

  const rows = await db.execute(sql.raw(`
    SELECT to_regclass('public.architect_state') AS state_table,
           to_regclass('public.architect_state_history') AS history_table
  `));
  console.log(JSON.stringify(rows[0]));
  process.exit(0);
}

main().catch((error) => {
  console.error("[retire-architect-state] FAILED:", error);
  process.exit(1);
});
