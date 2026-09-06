// ============================================================
// BODHI — One-shot heal of entities.mention_count drift
// Run via: npx tsx packages/db/src/migrations/heal-mention-counts.ts
//
// Idempotent: recomputes mention_count from the entity_memories
// junction table. Safe to run multiple times. Reports drift before
// healing so the operator can see how much rot accumulated.
//
// Use case: after the Apr 25 normalizer change (Mongolian Cyrillic
// transliteration), runs of dedup tooling, or any other change that
// soft-deletes / merges entities — the live count can drift from
// the true count.
// ============================================================

import "dotenv/config";
import { getDb } from "../client.js";
import { sql } from "drizzle-orm";

interface DriftRow {
  id: string;
  name: string;
  stored: number;
  truth: number;
  diff: number;
}

async function main() {
  const db = getDb();
  console.log("[heal-mention-counts] Connecting to DB...");

  const driftRows = (await db.execute(sql`
    SELECT
      e.id,
      e.name,
      e.mention_count AS stored,
      COALESCE((SELECT COUNT(*) FROM entity_memories em WHERE em.entity_id = e.id), 0) AS truth
    FROM entities e
  `)) as unknown as Array<{ id: string; name: string; stored: number; truth: number }>;

  const drifted: DriftRow[] = driftRows
    .map((r) => ({
      id: r.id,
      name: r.name,
      stored: Number(r.stored),
      truth: Number(r.truth),
      diff: Number(r.stored) - Number(r.truth),
    }))
    .filter((r) => r.diff !== 0)
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  console.log(
    `[heal-mention-counts] Scanned ${driftRows.length} entities — ${drifted.length} drifted (${(
      (drifted.length / Math.max(1, driftRows.length)) *
      100
    ).toFixed(1)}%)`
  );

  if (drifted.length === 0) {
    console.log("[heal-mention-counts] No drift detected. Done.");
    process.exit(0);
  }

  // Show top 10 worst
  console.log("[heal-mention-counts] Top 10 by drift magnitude:");
  for (const r of drifted.slice(0, 10)) {
    console.log(
      `  ${r.name.padEnd(40)} stored=${String(r.stored).padStart(5)} truth=${String(r.truth).padStart(5)} diff=${r.diff > 0 ? "+" : ""}${r.diff}`
    );
  }

  // Heal in a single statement
  await db.execute(sql`
    UPDATE entities
    SET mention_count = COALESCE(
      (SELECT COUNT(*) FROM entity_memories WHERE entity_id = entities.id),
      0
    )
    WHERE mention_count != COALESCE(
      (SELECT COUNT(*) FROM entity_memories WHERE entity_id = entities.id),
      0
    )
  `);

  console.log(`[heal-mention-counts] Healed ${drifted.length} entities. Done.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[heal-mention-counts] FAILED:", err);
  process.exit(1);
});
