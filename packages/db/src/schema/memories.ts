// ============================================================
// BODHI — Memory Schema (Drizzle ORM + pgvector)
// ============================================================

import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  pgEnum,
  real,
  integer,
} from "drizzle-orm/pg-core";
import { vector } from "drizzle-orm/pg-core";

export const memoryTypeEnum = pgEnum("memory_type", [
  "fact",
  "decision",
  "pattern",
  "preference",
  "event",
  "goal",
]);

export const memorySourceEnum = pgEnum("memory_source", [
  "conversation",
  "manual",
  "extraction",
  "synthesis",
]);

export const memoryStatusEnum = pgEnum("memory_status", [
  "confirmed",
  "pending",
  "rejected",
]);

// Authority tier (§2.6 "memory is not foundation", May 30 2026). Lets
// retrieval demote stale/superseded memories and promote durable ones.
// NOTE: constitutional docs are NOT in this table (knowledge provider),
// so this tiers episodic memories among themselves — see apply-memory-scope.ts.
export const memoryScopeEnum = pgEnum("memory_scope", [
  "foundational",
  "session-active",
  "archived",
]);

export const memories = pgTable("memories", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: memoryTypeEnum("type").notNull().default("fact"),
  content: text("content").notNull(),
  embedding: vector("embedding", { dimensions: 1024 }).notNull(),
  source: memorySourceEnum("source").notNull().default("extraction"),
  sourceThreadId: uuid("source_thread_id"),
  importance: real("importance").notNull().default(0.5),
  confidence: real("confidence").notNull().default(1.0),
  tags: jsonb("tags").$type<string[]>(),
  accessCount: integer("access_count").notNull().default(0),
  lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  status: memoryStatusEnum("status").notNull().default("confirmed"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  // Forgetting tier (Phase S1, May 18) — live in DB via apply-forgetting-tier.ts.
  recallCount: integer("recall_count").notNull().default(0),
  lastRecalledAt: timestamp("last_recalled_at", { withTimezone: true }),
  forgottenAt: timestamp("forgotten_at", { withTimezone: true }),
  // Authority tier (§2.6, May 30) — apply-memory-scope.ts.
  scope: memoryScopeEnum("scope").notNull().default("session-active"),
});
