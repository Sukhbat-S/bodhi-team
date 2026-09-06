// ============================================================
// BODHI — Conversation Schema (Drizzle ORM)
// ============================================================

import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  pgEnum,
  integer,
} from "drizzle-orm/pg-core";

export const channelEnum = pgEnum("channel", ["telegram", "web", "cli"]);
export const roleEnum = pgEnum("message_role", ["user", "assistant"]);

// --- Conversation Threads ---

export const extractionStatusEnum = pgEnum("extraction_status", [
  "pending",
  "success",
  "failed",
  "abandoned",
]);

export const conversationThreads = pgTable("conversation_threads", {
  id: uuid("id").primaryKey().defaultRandom(),
  channel: channelEnum("channel").notNull(),
  channelThreadId: text("channel_thread_id"),
  title: text("title"),
  summary: text("summary"),
  extractionStatus: extractionStatusEnum("extraction_status"),
  extractedAt: timestamp("extracted_at", { withTimezone: true }),
  extractionAttempts: integer("extraction_attempts").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// --- Conversation Turns ---

export const conversationTurns = pgTable("conversation_turns", {
  id: uuid("id").primaryKey().defaultRandom(),
  threadId: uuid("thread_id")
    .notNull()
    .references(() => conversationThreads.id, { onDelete: "cascade" }),
  role: roleEnum("role").notNull(),
  content: text("content").notNull(),
  channel: channelEnum("channel").notNull(),
  toolCalls: jsonb("tool_calls").$type<ToolCallJSON[]>(),
  contextSnapshot: jsonb("context_snapshot"),
  tokenUsage: jsonb("token_usage").$type<TokenUsageJSON>(),
  modelUsed: text("model_used"),
  durationMs: integer("duration_ms"),
  feedback: jsonb("feedback").$type<TurnFeedbackJSON>(),
  selfAssessment: jsonb("self_assessment").$type<SelfAssessmentJSON>(),
  // Phase B1 — CLI transcript ingest idempotency.
  // source_event_id is the JSONL line's `uuid` from Claude Code's
  // transcript file. Partial unique index enforced for non-null values.
  // source_timestamp preserves the original event time from the
  // transcript (vs createdAt which is ingest time).
  sourceEventId: text("source_event_id"),
  sourceTimestamp: timestamp("source_timestamp", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// bridge_tasks dropped May 19, 2026 (decision sweep). The table had
// 0 rows ever; the Bridge-task UI surface that was meant to render
// task progress was never shipped. Schema definition removed along
// with the DROP TABLE.

// --- JSON Types ---

interface ToolCallJSON {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output: string;
  durationMs: number;
  status: "success" | "error";
}

interface TokenUsageJSON {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface TurnFeedbackJSON {
  rating: "helpful" | "unhelpful";
  text?: string;
  at: string; // ISO timestamp
}

export interface SelfAssessmentJSON {
  score: number; // 1-5
  reasoning?: string;
  at: string; // ISO timestamp
}
