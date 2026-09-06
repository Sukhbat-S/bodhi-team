// ============================================================
// BODHI — Library search invocations telemetry (Wave 1 S3, May 19)
// Run via: npx tsx packages/db/src/migrations/apply-library-search-invocations.ts
//
// Closes the invisible-failure half of May 19's library diagnosis.
// Storage shipped Phase C; consumption was unmeasured. Every call
// to /api/library/search now writes one row here.
//
// Schema mirrors what skill_invocations *would* look like as its
// own table (today it's denormalized into system_events.kind='skill'
// rows). Library searches need typed columns because:
//   1. Query rate will rise sharply when LibraryProvider PUSH lands
//   2. Domain/sub_domain need to be indexed for "consultation rate
//      per domain" rollups in /agents (Wave 2 A4)
//   3. agent_context is the load-bearing dimension — separates
//      parent-Claude MCP calls from LibraryProvider auto-injection
//      from subagent fans from background services
//
// Idempotent.
// ============================================================

import "dotenv/config";
import { getDb } from "../client.js";
import { sql } from "drizzle-orm";

const TABLE_DDL = `
CREATE TABLE IF NOT EXISTS library_search_invocations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ts              timestamptz NOT NULL DEFAULT now(),
  query           text NOT NULL,
  domain          text,
  sub_domain      text,
  threshold       real,
  limit_n         integer,
  hits            integer NOT NULL,
  top_similarity  real,
  agent_context   text NOT NULL DEFAULT 'unknown',
  caller          text,
  metadata        jsonb
);
`;

const INDEX_TS_DDL = `
CREATE INDEX IF NOT EXISTS library_search_invocations_ts_idx
  ON library_search_invocations (ts DESC);
`;

const INDEX_DOMAIN_DDL = `
CREATE INDEX IF NOT EXISTS library_search_invocations_domain_idx
  ON library_search_invocations (domain, sub_domain);
`;

const INDEX_AGENT_DDL = `
CREATE INDEX IF NOT EXISTS library_search_invocations_agent_idx
  ON library_search_invocations (agent_context);
`;

async function main() {
  const db = getDb();
  console.log("[apply-library-search-invocations] Connecting...");

  await db.execute(sql.raw(TABLE_DDL));
  console.log("[apply-library-search-invocations] table ensured");

  await db.execute(sql.raw(INDEX_TS_DDL));
  await db.execute(sql.raw(INDEX_DOMAIN_DDL));
  await db.execute(sql.raw(INDEX_AGENT_DDL));
  console.log("[apply-library-search-invocations] indexes ensured");

  console.log("[apply-library-search-invocations] Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[apply-library-search-invocations] FAILED:", err);
  process.exit(1);
});
