// ============================================================
// BODHI — One-shot migration: add 'mid-day-check' to briefing_type
// Run via: npx tsx packages/db/src/migrations/apply-midday-check-enum.ts
//
// Idempotent. Mid-day check output (14:00 daily) previously went only
// to Telegram + push and vanished — no index, no history, no search.
// Persisting to the briefings table with a new type discriminator
// closes that loop without inventing a new table. Required for the
// evidence-bearing history contract in DESIGN.md (mid-day reflections
// become a queryable feed rather than invented dashboard telemetry).
// ============================================================

import "dotenv/config";
import { getDb } from "../client.js";
import { sql } from "drizzle-orm";

const ADD_ENUM_VALUE = `ALTER TYPE briefing_type ADD VALUE IF NOT EXISTS 'mid-day-check';`;

async function main() {
  const db = getDb();
  console.log("[midday-check-enum] Connecting to DB...");
  await db.execute(sql.raw(ADD_ENUM_VALUE));
  console.log("[midday-check-enum] briefing_type enum extended with 'mid-day-check'");
  console.log("[midday-check-enum] Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[midday-check-enum] FAILED:", err);
  process.exit(1);
});
