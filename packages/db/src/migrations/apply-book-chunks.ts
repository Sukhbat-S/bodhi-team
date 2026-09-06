// ============================================================
// BODHI — One-shot migration for the book_chunks table
// Run via: npx tsx packages/db/src/migrations/apply-book-chunks.ts
//
// Idempotent: safe to run multiple times. Only creates the table
// and indexes if they don't already exist.
//
// pgvector extension must already be enabled (it is — memories
// table uses it).
// ============================================================

import "dotenv/config";
import { getDb } from "../client.js";
import { sql } from "drizzle-orm";

const BOOK_CHUNKS_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS book_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_title text NOT NULL,
  book_author text NOT NULL,
  chapter text,
  page_start integer,
  page_end integer,
  chunk_index integer NOT NULL,
  content text NOT NULL,
  embedding vector(1024) NOT NULL,
  tags jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (book_title, chunk_index)
);
`;

const BOOK_CHUNKS_IDX_DDL = `
CREATE INDEX IF NOT EXISTS book_chunks_tags_gin ON book_chunks USING gin(tags);
CREATE INDEX IF NOT EXISTS book_chunks_title_idx ON book_chunks (book_title);
`;

async function main() {
  const db = getDb();
  console.log("[book-chunks-migration] Connecting to DB...");
  await db.execute(sql.raw(BOOK_CHUNKS_TABLE_DDL));
  console.log("[book-chunks-migration] book_chunks table ensured");
  await db.execute(sql.raw(BOOK_CHUNKS_IDX_DDL));
  console.log("[book-chunks-migration] indexes ensured");
  console.log("[book-chunks-migration] Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[book-chunks-migration] FAILED:", err);
  process.exit(1);
});
