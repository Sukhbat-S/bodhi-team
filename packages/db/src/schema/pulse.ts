// ============================================================
// BODHI — Live-pulse schema (Drizzle ORM + pgvector)
//
// ORPHANED DATA, Jul 25 2026 (Wave D prune). The live-pulse cron that wrote this
// table, the /api/pulse-findings routes that upserted it, and the autonomy-status
// row that was its last reader are all DELETED. What remains here maps a table
// that still exists but has no writer and no reader.
//
//   pulse_findings — URL-keyed recurrence store, 372 rows at prune time. KEPT
//                    deliberately: the drop_unused_db_column tier admits only
//                    provably-unused tables and says "anything holding real data
//                    stays await", so the drop is the architect's call, not a
//                    subagent's. Dump: /tmp/bodhi-pulse-tables-jul25.sql.
//                    Delete this file together with the table when that call comes.
//
//   (pulse_topics  — DROPPED Jul 25 2026. 0 rows for its entire life, no writer,
//                    no reader, no FK dependents; the v1.1 watchlist it was
//                    pre-created for never shipped.)
//
// Migration of record: packages/db/src/migrations/apply-pulse.ts.
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

export const pulseFindings = pgTable(
  "pulse_findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    topicId: uuid("topic_id"),
    sourceUrl: text("source_url").notNull(),
    title: text("title").notNull(),
    summary: text("summary"),
    sources: jsonb("sources").$type<string[]>(),
    uncertainty: text("uncertainty").notNull(),
    score: integer("score"),
    sightingCount: integer("sighting_count").notNull().default(1),
    firstSeen: timestamp("first_seen", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeen: timestamp("last_seen", { withTimezone: true })
      .notNull()
      .defaultNow(),
    embedding: vector("embedding", { dimensions: 1024 }),
  },
  (table) => ({
    sourceUrlUnique: unique("pulse_findings_source_url_unique").on(
      table.sourceUrl
    ),
  })
);
