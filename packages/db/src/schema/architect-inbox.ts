// ============================================================
// BODHI — Architect Inbox Schema (Drizzle ORM)
//
// Failed subagent dispatches + budget halts + memory contradictions
// all post to this inbox. The C3 oracle surfaces high-severity rows
// as Tier 2 suggestions at session-start. Dashboard /status badge
// shows undismissed count.
//
// Phase 33 C2 (Plyrium absorption), May 25, 2026.
// Migration: packages/db/src/migrations/apply-architect-inbox.ts
// ============================================================

import { pgTable, text, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { InferSelectModel, InferInsertModel } from "drizzle-orm";

export type ArchitectInboxSeverity = "high" | "medium" | "low";

export const ARCHITECT_INBOX_SEVERITIES: ArchitectInboxSeverity[] = [
  "high",
  "medium",
  "low",
];

export const architectInbox = pgTable(
  "architect_inbox",
  {
    id: text("id").primaryKey(),
    severity: text("severity").$type<ArchitectInboxSeverity>().notNull(),
    kind: text("kind").notNull(),
    summary: text("summary").notNull(),
    contextHash: text("context_hash"),
    relatedDispatchId: text("related_dispatch_id"),
    postedAt: timestamp("posted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
  },
  (table) => ({
    severityCheck: check(
      "architect_inbox_severity_chk",
      sql`${table.severity} IN ('high', 'medium', 'low')`
    ),
  })
);

export type ArchitectInbox = InferSelectModel<typeof architectInbox>;
export type NewArchitectInbox = InferInsertModel<typeof architectInbox>;
