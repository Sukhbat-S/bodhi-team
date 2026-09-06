// ============================================================
// BODHI — One-shot migration: add 'morning-thought' to briefing_type
// Run via: npx tsx packages/db/src/migrations/apply-morning-thought-enum.ts
//
// Idempotent: ALTER TYPE ... ADD VALUE IF NOT EXISTS is safe to
// re-run. Required for Heart phase — voiced first-person morning
// thought reuses the briefings table with a new type discriminator.
// ============================================================

import "dotenv/config";
import { getDb } from "../client.js";
import { sql } from "drizzle-orm";

const ADD_ENUM_VALUE = `ALTER TYPE briefing_type ADD VALUE IF NOT EXISTS 'morning-thought';`;

async function main() {
  const db = getDb();
  console.log("[morning-thought-enum] Connecting to DB...");
  await db.execute(sql.raw(ADD_ENUM_VALUE));
  console.log("[morning-thought-enum] briefing_type enum extended with 'morning-thought'");
  console.log("[morning-thought-enum] Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[morning-thought-enum] FAILED:", err);
  process.exit(1);
});
