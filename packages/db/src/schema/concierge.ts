// ============================================================
// BODHI — Concierge State Schema (Drizzle ORM)
//
// Singleton row per channel. The Concierge (BODHI's continuous
// voice) owns one conversation_thread per channel and never
// rotates it. workingSet holds the agent's working memory:
// what it has handled silently, what it's watching, what's
// queued for digest.
//
// Conversation history lives in conversation_threads + turns
// (reused). Long-term facts live in memories (reused, tagged
// "concierge"). This table only tracks the head-agent's
// orchestrator state — what doesn't fit the message log.
// ============================================================
//
// Author: Concierge Phase 1 (Apr 29).
// ============================================================
import {
  pgTable,
  uuid,
  jsonb,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { channelEnum, conversationThreads } from "./conversations.js";

export interface ConciergeWorkingSet {
  handledSilently: Array<{
    at: string;
    kind: string;
    action: string;
    reason: string;
  }>;
  activeWatches: Array<{
    id: string;
    kind: string;
    summary: string;
    sinceTs: string;
  }>;
  taskQueue: Array<{
    id: string;
    description: string;
    dispatchedTo?: string;
    status: "queued" | "dispatched" | "complete" | "failed";
    createdAt: string;
  }>;
  notesForDigest: Array<{ at: string; note: string }>;
}

export const conciergeState = pgTable(
  "concierge_state",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channel: channelEnum("channel").notNull(),
    threadId: uuid("thread_id").references(() => conversationThreads.id, {
      onDelete: "set null",
    }),
    workingSet: jsonb("working_set").$type<ConciergeWorkingSet>().notNull().default({
      handledSilently: [],
      activeWatches: [],
      taskQueue: [],
      notesForDigest: [],
    }),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    channelUnique: uniqueIndex("concierge_state_channel_unique").on(table.channel),
  })
);
