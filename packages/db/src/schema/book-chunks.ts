// ============================================================
// BODHI — Book Chunks Schema (Drizzle ORM + pgvector)
// Stores embedded passages from ingested reference books.
// Separate from `memories` to avoid polluting the memory-decay
// and access-tracking logic with static reference content.
// ============================================================

import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  unique,
} from "drizzle-orm/pg-core";
import { vector } from "drizzle-orm/pg-core";

export const bookChunks = pgTable(
  "book_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookTitle: text("book_title").notNull(),
    bookAuthor: text("book_author").notNull(),
    chapter: text("chapter"),
    pageStart: integer("page_start"),
    pageEnd: integer("page_end"),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1024 }).notNull(),
    tags: jsonb("tags").$type<string[]>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    bookTitleChunkIdxUnique: unique("book_chunks_title_chunk_unique").on(
      table.bookTitle,
      table.chunkIndex
    ),
  })
);
