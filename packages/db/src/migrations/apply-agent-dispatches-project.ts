// ============================================================
// BODHI — agent_dispatches.project column (OMEGA Phase 3, Jun 15 2026)
// Run via: npx tsx scripts/verified-migrate.ts packages/db/src/migrations/apply-agent-dispatches-project.ts
//
// THE load-bearing gap for the portfolio-COO rollup: every dispatch row needs a
// venture slice so the /api/portfolio/ventures rollup can count open/recent
// dispatches per venture. Additive + idempotent, modeled EXACTLY on
// apply-research-findings.ts so it passes the verified-migrate 6-gate:
// only ALTER TABLE ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS, NO ${}
// interpolation in the DDL template literals (plain no-substitution backtick
// constants), imports limited to dotenv/config | ../client.js | drizzle-orm.
//
// The verified-migrate static gate recognizes
//   ALTER TABLE <t> ADD COLUMN IF NOT EXISTS <c>
// as an ADDITIVE shape (staticGate ADDITIVE matcher) — confirmed before authoring.
//
//   agent_dispatches.project — text, nullable (no backfill required; the recording
//                              path tags new dispatches from the dispatch cwd).
//                              Indexed for the per-venture COUNT slice.
//
// Idempotent: re-running is safe (all guards are IF NOT EXISTS).
// ============================================================

import "dotenv/config";
import { getDb } from "../client.js";
import { sql } from "drizzle-orm";

const ADD_PROJECT_COLUMN_DDL = `
ALTER TABLE agent_dispatches ADD COLUMN IF NOT EXISTS project text;
`;

const INDEX_PROJECT_DDL = `
CREATE INDEX IF NOT EXISTS agent_dispatches_project_idx
  ON agent_dispatches (project);
`;

async function main() {
  const db = getDb();
  console.log("[apply-agent-dispatches-project] Connecting to DB...");

  await db.execute(sql.raw(ADD_PROJECT_COLUMN_DDL));
  console.log("[apply-agent-dispatches-project] project column ensured");

  await db.execute(sql.raw(INDEX_PROJECT_DDL));
  console.log("[apply-agent-dispatches-project] project index ensured");

  console.log("[apply-agent-dispatches-project] Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[apply-agent-dispatches-project] FAILED:", err);
  process.exit(1);
});
