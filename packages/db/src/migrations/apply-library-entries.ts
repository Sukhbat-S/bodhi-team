// ============================================================
// BODHI — Domain knowledge library (Phase C, C1, May 17)
// Run via: npx tsx packages/db/src/migrations/apply-library-entries.ts
//
// Layer-3 reference library: semantic-retrievable corpus
// chunked + embedded so agents query for evidence instead of
// re-deriving from generalist priors. Sister to book_chunks
// (marketing-books RAG) but scoped to domain knowledge:
// design, security, engineering, research, interaction.
//
// Schema:
//   source       — relative path under library/, the citation handle
//   domain       — top-level (design | security | engineering | research | interaction | ...)
//   sub_domain   — second-level routing (typography | owasp | motion | ...) — nullable
//   chunk_index  — 0-based ordinal within source; (source, chunk_index) UNIQUE for idempotency
//   chunk_text   — the chunk content (already normalized)
//   embedding    — vector(1024), voyage-4-lite (matches memories + book_chunks)
//   metadata     — jsonb: { heading, char_start, char_end, tags?, title?, author?, ... }
//
// Idempotent: re-running the migration is safe; re-running the
// ingest script skips sources that already have rows (full
// re-embed requires explicit purge — see ingest --force flag).
// ============================================================

import "dotenv/config";
import { getDb } from "../client.js";
import { sql } from "drizzle-orm";

const CREATE_DDL = `
CREATE TABLE IF NOT EXISTS library_entries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source       text NOT NULL,
  domain       text NOT NULL,
  sub_domain   text,
  chunk_index  integer NOT NULL,
  chunk_text   text NOT NULL,
  embedding    vector(1024) NOT NULL,
  metadata     jsonb,
  created_at   timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (source, chunk_index)
);
`;

const INDEX_DOMAIN_DDL = `
CREATE INDEX IF NOT EXISTS library_entries_domain_idx
  ON library_entries (domain, sub_domain);
`;

const INDEX_SOURCE_DDL = `
CREATE INDEX IF NOT EXISTS library_entries_source_idx
  ON library_entries (source);
`;

const INDEX_METADATA_DDL = `
CREATE INDEX IF NOT EXISTS library_entries_metadata_gin
  ON library_entries USING gin(metadata);
`;

async function main() {
  const db = getDb();
  console.log("[apply-library-entries] Connecting to DB...");

  await db.execute(sql.raw(CREATE_DDL));
  console.log("[apply-library-entries] library_entries table ensured");

  await db.execute(sql.raw(INDEX_DOMAIN_DDL));
  await db.execute(sql.raw(INDEX_SOURCE_DDL));
  await db.execute(sql.raw(INDEX_METADATA_DDL));
  console.log("[apply-library-entries] indexes ensured");

  console.log("[apply-library-entries] Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[apply-library-entries] FAILED:", err);
  process.exit(1);
});
