// ============================================================
// BODHI — Live-pulse tables (Phase 2, Jun 14 2026)
// Run via: npx tsx scripts/verified-migrate.ts packages/db/src/migrations/apply-pulse.ts
//
// Additive + idempotent, modeled EXACTLY on apply-library-entries.ts so it
// passes the verified-migrate 6-gate: only CREATE TABLE/INDEX IF NOT EXISTS,
// NO ${} interpolation in the DDL template literals (plain no-substitution
// backtick constants), imports limited to dotenv/config | ../client.js |
// drizzle-orm.
//
//   pulse_findings — URL-keyed recurrence store (UNIQUE source_url). The
//                    cron upserts cluster representatives; a repeat sighting
//                    bumps sighting_count + last_seen. `embedding` (nullable,
//                    vector(1024)) is created now so the v1.1 embedding-cluster
//                    swap needs no second migration. (pgvector already present —
//                    book_chunks + library_entries use vector(1024).)
//
// Idempotent: re-running is safe (all guards are IF NOT EXISTS).
// ============================================================

import "dotenv/config";
import { getDb } from "../client.js";
import { sql } from "drizzle-orm";

// (CREATE_TOPICS_DDL REMOVED Jul 25, 2026 — Wave D DROPped pulse_topics: 0 rows
// for its whole life, no writer, no reader, no FK dependents. The statement is
// deleted rather than commented because it was `IF NOT EXISTS` + idempotent, so
// a well-meaning re-run of this migration would have silently RESURRECTED the
// dropped table and the additive-only verified-migrate gate would have passed it.)

const CREATE_FINDINGS_DDL = `
CREATE TABLE IF NOT EXISTS pulse_findings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id       uuid,
  source_url     text NOT NULL,
  title          text NOT NULL,
  summary        text,
  sources        jsonb,
  uncertainty    text NOT NULL,
  score          integer,
  sighting_count integer NOT NULL DEFAULT 1,
  first_seen     timestamptz NOT NULL DEFAULT NOW(),
  last_seen      timestamptz NOT NULL DEFAULT NOW(),
  embedding      vector(1024)
);
`;

const INDEX_SOURCE_URL_UNIQUE_DDL = `
CREATE UNIQUE INDEX IF NOT EXISTS pulse_findings_source_url_unique
  ON pulse_findings (source_url);
`;

const INDEX_TOPIC_ID_DDL = `
CREATE INDEX IF NOT EXISTS pulse_findings_topic_id_idx
  ON pulse_findings (topic_id);
`;

const INDEX_LAST_SEEN_DDL = `
CREATE INDEX IF NOT EXISTS pulse_findings_last_seen_idx
  ON pulse_findings (last_seen);
`;

async function main() {
  const db = getDb();
  console.log("[apply-pulse] Connecting to DB...");

  await db.execute(sql.raw(CREATE_FINDINGS_DDL));
  console.log("[apply-pulse] pulse_findings table ensured");

  await db.execute(sql.raw(INDEX_SOURCE_URL_UNIQUE_DDL));
  await db.execute(sql.raw(INDEX_TOPIC_ID_DDL));
  await db.execute(sql.raw(INDEX_LAST_SEEN_DDL));
  console.log("[apply-pulse] indexes ensured");

  console.log("[apply-pulse] Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[apply-pulse] FAILED:", err);
  process.exit(1);
});
