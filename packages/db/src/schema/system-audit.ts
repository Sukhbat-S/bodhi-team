// ============================================================
// BODHI — System Audit Schema (Drizzle ORM)
//
// Append-only audit trail of side-effecting tools. Stores hash +
// length + non-sensitive metadata; NEVER stores payload bytes. A
// future refactor that bypasses the redactor cannot leak — there's
// nothing to leak.
//
// Phase 33 C1 (Plyrium absorption), May 25, 2026.
// Migration: packages/db/src/migrations/apply-system-audit.ts
//
// Source-of-truth for SUBSTRATE.md §7 drift finding #4 (memory
// provenance is loose) — partial closure via this table.
// ============================================================

import { pgTable, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import type { InferSelectModel, InferInsertModel } from "drizzle-orm";

export const systemAudit = pgTable(
  "system_audit",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    actor: text("actor").notNull(),
    target: text("target"),
    payloadHash: text("payload_hash"),
    payloadLength: integer("payload_length"),
    metadata: jsonb("metadata"),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    kindTsIdx: index("system_audit_kind_ts").on(table.kind, table.ts),
    actorTsIdx: index("system_audit_actor_ts").on(table.actor, table.ts),
  })
);

export type SystemAudit = InferSelectModel<typeof systemAudit>;
export type NewSystemAudit = InferInsertModel<typeof systemAudit>;
