// ============================================================
// BODHI — memory_calibration (Phase 33 B2, May 25, 2026)
// Run via: npx tsx packages/db/src/migrations/apply-memory-calibration.ts
//
// Per-type calibration table. mineCorrectionSignals writes here on
// contradiction events; retrieve() multiplies importance by scale_scale
// so contradicted-prone types sink in ranking.
//
// Seeded with 6 known memory types at neutral (bias=0, scale=1).
// Idempotent.
// ============================================================

import "dotenv/config";
import { getDb } from "../client.js";
import { sql } from "drizzle-orm";

const KNOWN_TYPES = ["fact", "decision", "pattern", "preference", "event", "goal"];

async function main(): Promise<void> {
  const db = getDb();
  console.log("[apply-memory-calibration] Connecting...");

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS memory_calibration (
      memory_type TEXT PRIMARY KEY,
      total_sampled INTEGER NOT NULL DEFAULT 0,
      total_correct INTEGER NOT NULL DEFAULT 0,
      bias_scale DOUBLE PRECISION NOT NULL DEFAULT 0,
      scale_scale DOUBLE PRECISION NOT NULL DEFAULT 1,
      last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `));
  console.log("[apply-memory-calibration] table ensured");

  for (const t of KNOWN_TYPES) {
    await db.execute(sql`
      INSERT INTO memory_calibration (memory_type)
      VALUES (${t})
      ON CONFLICT (memory_type) DO NOTHING
    `);
  }
  console.log("[apply-memory-calibration] 6 types seeded at neutral");

  console.log("[apply-memory-calibration] Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[apply-memory-calibration] FAILED:", err);
  process.exit(1);
});
