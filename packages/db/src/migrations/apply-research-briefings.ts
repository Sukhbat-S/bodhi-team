// ============================================================
// BODHI — Research-briefings table (OMEGA Phase 2a, Jun 15 2026)
// Run via: npx tsx scripts/verified-migrate.ts packages/db/src/migrations/apply-research-briefings.ts
//
// Additive + idempotent, modeled EXACTLY on apply-research-findings.ts so it
// passes the verified-migrate 6-gate: only CREATE TABLE/INDEX IF NOT EXISTS, NO
// ${} interpolation in the DDL template literals (plain no-substitution backtick
// constants), imports limited to dotenv/config | ../client.js | drizzle-orm.
//
//   research_briefings — the INTERNAL Mongolian-briefing store. The mn-briefing
//                        cron INSERTs one row per generated briefing (topic, title,
//                        body_md, source_finding_ids, model). INTERNAL-ONLY: the
//                        table + GET /api/research-briefings are the only surfaces;
//                        nothing is published from here.
//
// Idempotent: re-running is safe (all guards are IF NOT EXISTS).
// ============================================================

import "dotenv/config";
import { getDb } from "../client.js";
import { sql } from "drizzle-orm";

const CREATE_BRIEFINGS_DDL = `
CREATE TABLE IF NOT EXISTS research_briefings (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic              text NOT NULL,
  lang               text NOT NULL DEFAULT 'mn',
  title              text NOT NULL,
  body_md            text NOT NULL,
  source_finding_ids jsonb, -- holds source_url strings (provenance), NOT research_findings.id
  model              text,
  created_at         timestamptz NOT NULL DEFAULT NOW()
);
`;

const INDEX_CREATED_AT_DDL = `
CREATE INDEX IF NOT EXISTS research_briefings_created_at_idx
  ON research_briefings (created_at);
`;

async function main() {
  const db = getDb();
  console.log("[apply-research-briefings] Connecting to DB...");

  await db.execute(sql.raw(CREATE_BRIEFINGS_DDL));
  console.log("[apply-research-briefings] research_briefings table ensured");

  await db.execute(sql.raw(INDEX_CREATED_AT_DDL));
  console.log("[apply-research-briefings] indexes ensured");

  console.log("[apply-research-briefings] Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[apply-research-briefings] FAILED:", err);
  process.exit(1);
});
