// ============================================================
// BODHI — Briefings Schema
// Persists generated briefings for the PWA feed
// ============================================================

import { pgTable, uuid, text, timestamp, pgEnum, jsonb, real } from "drizzle-orm/pg-core";

export const briefingTypeEnum = pgEnum("briefing_type", [
  "morning",
  "evening",
  "weekly",
  "daily-intel",
  "jewelry-changelog",
  // Apr 28: voiced first-person "morning thought" — replaces structured
  // morning briefing for the brain home. Same row shape, different prompt.
  "morning-thought",
  // May 15: mid-day check (14:00 daily) output persisted as briefing row
  // — was Telegram-only and ephemeral. Keeps mid-day history queryable under
  // the current evidence-bearing surface contract in DESIGN.md.
  "mid-day-check",
]);

export const briefings = pgTable("briefings", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: briefingTypeEnum("type").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  // May 9: confidence calibration (DESIGN.md §11.2 + §8.1 #12). The input
  // memory pool that fed generation, plus its mean confidence. NULL
  // avgConfidence on pre-migration rows — UI treats absence as "no pill."
  sourceMemoryIds: jsonb("source_memory_ids").$type<string[]>().default([]).notNull(),
  avgConfidence: real("avg_confidence"),
  // May 9 (PM): provenance strip (DESIGN.md §11.1 + §8.1 #11). Captures
  // which providers fired, token contribution, model, duration. Empty
  // object on pre-migration rows — UI treats absence as "no strip."
  contextBreakdown: jsonb("context_breakdown")
    .$type<{
      providers?: { name: string; tokens: number; fired: boolean; reason?: string }[];
      model?: string;
      totalTokens?: number;
      durationMs?: number;
    }>()
    .default({})
    .notNull(),
});
