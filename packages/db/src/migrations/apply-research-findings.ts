// ============================================================
// BODHI — Research tables (OMEGA Phase 0, Jun 15 2026)
// Run via: npx tsx scripts/verified-migrate.ts packages/db/src/migrations/apply-research-findings.ts
//
// Additive + idempotent, modeled EXACTLY on apply-pulse.ts so it passes the
// verified-migrate 6-gate: only CREATE TABLE/INDEX IF NOT EXISTS, NO ${}
// interpolation in the DDL template literals (plain no-substitution backtick
// constants), imports limited to dotenv/config | ../client.js | drizzle-orm.
//
//   research_findings — (question, source_url)-keyed recurrence store with the
//                       OMEGA Phase-0 quality columns (claim_supported,
//                       source_reachable, verdict_floor, verify_model). Composite
//                       UNIQUE(question, source_url) — distinct from the live-pulse
//                       global UNIQUE(source_url) so the two crons never collide.
//                       `embedding` (nullable, vector(1024)) created now so a future
//                       embedding-cluster swap needs no second migration.
//   research_runs     — one row per run: the GEPA time series of run-level quality
//                       metrics (sources_reachable_pct / claims_verified_pct /
//                       citation_accuracy).
//
// Idempotent: re-running is safe (all guards are IF NOT EXISTS).
// ============================================================

import "dotenv/config";
import { getDb } from "../client.js";
import { sql } from "drizzle-orm";

const CREATE_FINDINGS_DDL = `
CREATE TABLE IF NOT EXISTS research_findings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question         text NOT NULL,
  source_url       text NOT NULL,
  title            text NOT NULL,
  summary          text,
  sources          jsonb,
  uncertainty      text NOT NULL,
  score            integer,
  claim_supported  numeric,
  source_reachable boolean,
  verdict_floor    boolean,
  verify_model     text,
  sighting_count   integer NOT NULL DEFAULT 1,
  first_seen       timestamptz NOT NULL DEFAULT NOW(),
  last_seen        timestamptz NOT NULL DEFAULT NOW(),
  embedding        vector(1024)
);
`;

const CREATE_RUNS_DDL = `
CREATE TABLE IF NOT EXISTS research_runs (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at                 timestamptz NOT NULL DEFAULT NOW(),
  questions              integer,
  findings_total         integer,
  findings_verified      integer,
  sources_reachable_pct  numeric,
  claims_verified_pct    numeric,
  citation_accuracy      numeric,
  verify_enabled         boolean,
  verify_model           text,
  sonar_enabled          boolean
);
`;

const INDEX_QUESTION_SOURCE_UNIQUE_DDL = `
CREATE UNIQUE INDEX IF NOT EXISTS research_findings_question_source_url_unique
  ON research_findings (question, source_url);
`;

const INDEX_LAST_SEEN_DDL = `
CREATE INDEX IF NOT EXISTS research_findings_last_seen_idx
  ON research_findings (last_seen);
`;

const INDEX_RUNS_RUN_AT_DDL = `
CREATE INDEX IF NOT EXISTS research_runs_run_at_idx
  ON research_runs (run_at);
`;

async function main() {
  const db = getDb();
  console.log("[apply-research-findings] Connecting to DB...");

  await db.execute(sql.raw(CREATE_FINDINGS_DDL));
  console.log("[apply-research-findings] research_findings table ensured");

  await db.execute(sql.raw(CREATE_RUNS_DDL));
  console.log("[apply-research-findings] research_runs table ensured");

  await db.execute(sql.raw(INDEX_QUESTION_SOURCE_UNIQUE_DDL));
  await db.execute(sql.raw(INDEX_LAST_SEEN_DDL));
  await db.execute(sql.raw(INDEX_RUNS_RUN_AT_DDL));
  console.log("[apply-research-findings] indexes ensured");

  console.log("[apply-research-findings] Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[apply-research-findings] FAILED:", err);
  process.exit(1);
});
