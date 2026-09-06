// ============================================================
// BODHI — pgvector HNSW indexes + memories hot-path composite index
// Run via: npx tsx packages/db/src/migrations/apply-vector-hnsw-indexes.ts
//
// Idempotent: safe to run multiple times (CREATE INDEX IF NOT EXISTS).
//
// Why: no ANN index existed on ANY of the three embedding columns, so every
// semantic search (search_memories on most chat turns, briefings, and the
// synthesizer's ~600 nightly findSimilarToMemory scans) was a full sequential
// scan with per-row 1024-dim cosine math. HNSW with vector_cosine_ops matches
// the `<=>` operator used everywhere. findSimilarToMemory (ORDER BY embedding
// <=> target) uses it directly; retrieve() uses it via its CTE-prefilter
// restructure (see MemoryService.retrieve).
//
// CREATE INDEX CONCURRENTLY does not lock the table for writes, but it cannot
// run inside a transaction block — db.execute() issues each statement in
// autocommit, so this is fine. Each statement is wrapped so a missing/empty
// table (e.g. library_entries on a fresh fork) doesn't block the others.
// ============================================================

import "dotenv/config";
import { getDb } from "../client.js";
import { sql } from "drizzle-orm";

const STATEMENTS: Array<{ label: string; ddl: string }> = [
  {
    label: "memories.embedding HNSW (cosine)",
    ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS memories_embedding_hnsw_idx
            ON memories USING hnsw (embedding vector_cosine_ops);`,
  },
  {
    label: "book_chunks.embedding HNSW (cosine)",
    ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS book_chunks_embedding_hnsw_idx
            ON book_chunks USING hnsw (embedding vector_cosine_ops);`,
  },
  {
    label: "library_entries.embedding HNSW (cosine)",
    ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS library_entries_embedding_hnsw_idx
            ON library_entries USING hnsw (embedding vector_cosine_ops);`,
  },
  {
    label: "memories (status, type, created_at DESC) composite",
    ddl: `CREATE INDEX CONCURRENTLY IF NOT EXISTS memories_status_type_created_idx
            ON memories (status, type, created_at DESC);`,
  },
];

async function main() {
  const db = getDb();
  console.log("[hnsw-migration] Connecting to DB...");
  let ok = 0;
  let skipped = 0;
  for (const { label, ddl } of STATEMENTS) {
    try {
      await db.execute(sql.raw(ddl));
      console.log(`[hnsw-migration] ✓ ${label}`);
      ok++;
    } catch (err) {
      // Don't abort the whole migration on one bad table — log + continue.
      console.warn(`[hnsw-migration] ⚠ skipped ${label}: ${err instanceof Error ? err.message : err}`);
      skipped++;
    }
  }
  console.log(`[hnsw-migration] Done. ${ok} created/ensured, ${skipped} skipped.`);
  process.exit(skipped > 0 && ok === 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[hnsw-migration] FAILED:", err);
  process.exit(1);
});
