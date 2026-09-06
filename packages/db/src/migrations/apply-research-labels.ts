// ============================================================
// BODHI — Research labels table (OMEGA Phase 1.5, Jun 15 2026)
// Run via: npx tsx scripts/verified-migrate.ts packages/db/src/migrations/apply-research-labels.ts
//
// Additive + idempotent, modeled EXACTLY on apply-research-findings.ts so it passes
// the verified-migrate 6-gate: only CREATE TABLE/INDEX IF NOT EXISTS, NO ${}
// interpolation in the DDL template literals (plain no-substitution backtick
// constants), imports limited to dotenv/config | ../client.js | drizzle-orm.
//
//   research_labels — the human-authored ground truth for the research-verify GEPA
//                     loop. SEPARATE table (not a column on research_findings) so a
//                     label is decoupled from the cron's machine score
//                     (claim_supported) — the loop NEVER reads a machine score as a
//                     label. label='good'|'bad'; label_source='human-review'|'backfill'.
//                     Composite UNIQUE(question, source_url) — one authoritative
//                     label per (question, url); the API enforces immutability
//                     (409 unless ?override=1).
//
// Idempotent: re-running is safe (all guards are IF NOT EXISTS).
// ============================================================

import "dotenv/config";
import { getDb } from "../client.js";
import { sql } from "drizzle-orm";

const CREATE_LABELS_DDL = `
CREATE TABLE IF NOT EXISTS research_labels (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question     text NOT NULL,
  source_url   text NOT NULL,
  label        text NOT NULL,
  label_source text NOT NULL,
  labeled_by   text,
  rationale    text,
  labeled_at   timestamptz NOT NULL DEFAULT NOW()
);
`;

const INDEX_QUESTION_SOURCE_UNIQUE_DDL = `
CREATE UNIQUE INDEX IF NOT EXISTS research_labels_question_source_url_unique
  ON research_labels (question, source_url);
`;

const INDEX_LABELED_AT_DDL = `
CREATE INDEX IF NOT EXISTS research_labels_labeled_at_idx
  ON research_labels (labeled_at);
`;

async function main() {
  const db = getDb();
  console.log("[apply-research-labels] Connecting to DB...");

  await db.execute(sql.raw(CREATE_LABELS_DDL));
  console.log("[apply-research-labels] research_labels table ensured");

  await db.execute(sql.raw(INDEX_QUESTION_SOURCE_UNIQUE_DDL));
  await db.execute(sql.raw(INDEX_LABELED_AT_DDL));
  console.log("[apply-research-labels] indexes ensured");

  console.log("[apply-research-labels] Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[apply-research-labels] FAILED:", err);
  process.exit(1);
});
