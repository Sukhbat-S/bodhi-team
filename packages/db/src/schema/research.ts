// ============================================================
// BODHI — Research schema (Drizzle ORM + pgvector) — OMEGA Phase 0, Jun 15 2026
//
// The autonomous research cron's TYPED, queryable store + per-finding quality
// score. Distinct from pulse_findings on purpose: pulse_findings has a GLOBAL
// UNIQUE(source_url) (would collide research vs live-pulse URLs) and no quality
// columns. These tables add a composite UNIQUE(question, source_url) + the
// claim-verification columns OMEGA Phase 1's GEPA loop will optimize against.
//
//   research_findings — (question, source_url)-keyed recurrence store. The cron
//                       upserts cluster representatives; a repeat sighting bumps
//                       sighting_count + last_seen (ON CONFLICT upsert in
//                       routes/research-findings.ts). The verify columns
//                       (claim_supported / source_reachable / verdict_floor /
//                       verify_model) carry the Phase-0 quality signal —
//                       DESCRIPTIVE, not gating (calibration deferred to Phase 1).
//                       `embedding` (nullable, vector(1024)) created now so a
//                       future embedding-clustering swap needs no second migration.
//   research_runs    — one row per run: the GEPA time series. sources_reachable_pct
//                       / claims_verified_pct / citation_accuracy are the run-level
//                       quality metrics.
//
// Modeled on schema/pulse.ts. Migration:
//   packages/db/src/migrations/apply-research-findings.ts (verified-migrate 6-gate).
// ============================================================

import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  boolean,
  numeric,
  unique,
} from "drizzle-orm/pg-core";
import { vector } from "drizzle-orm/pg-core";

export const researchFindings = pgTable(
  "research_findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    question: text("question").notNull(),
    sourceUrl: text("source_url").notNull(),
    title: text("title").notNull(),
    summary: text("summary"),
    sources: jsonb("sources").$type<string[]>(),
    uncertainty: text("uncertainty").notNull(),
    score: integer("score"),
    // OMEGA Phase 0 quality columns (descriptive, not gating — see Phase 1).
    claimSupported: numeric("claim_supported"), // 0..1 judge verdict, null if unverified
    sourceReachable: boolean("source_reachable"), // null = not attempted
    verdictFloor: boolean("verdict_floor"), // claimSupported >= rubric floor
    verifyModel: text("verify_model"), // the model that produced claim_supported
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
    questionSourceUnique: unique("research_findings_question_source_url_unique").on(
      table.question,
      table.sourceUrl,
    ),
  }),
);

// research_labels — human-authored ground truth for the research-verify GEPA loop
// (OMEGA Phase 1.5). SEPARATE from research_findings so a label is never conflated
// with the cron's machine score (claim_supported). One authoritative label per
// (question, source_url): composite UNIQUE; the API enforces immutability.
//   label        — 'good' | 'bad'
//   label_source — 'human-review' (the /api/research-labels route) | 'backfill'
export const researchLabels = pgTable(
  "research_labels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    question: text("question").notNull(),
    sourceUrl: text("source_url").notNull(),
    label: text("label").notNull(), // 'good' | 'bad'
    labelSource: text("label_source").notNull(), // 'human-review' | 'backfill'
    labeledBy: text("labeled_by"),
    rationale: text("rationale"),
    labeledAt: timestamp("labeled_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    questionSourceUnique: unique("research_labels_question_source_url_unique").on(
      table.question,
      table.sourceUrl,
    ),
  }),
);

export const researchRuns = pgTable("research_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
  questions: integer("questions"),
  findingsTotal: integer("findings_total"),
  findingsVerified: integer("findings_verified"),
  // Run-level quality metrics (the GEPA time series).
  sourcesReachablePct: numeric("sources_reachable_pct"),
  claimsVerifiedPct: numeric("claims_verified_pct"),
  citationAccuracy: numeric("citation_accuracy"),
  verifyEnabled: boolean("verify_enabled"),
  verifyModel: text("verify_model"),
  sonarEnabled: boolean("sonar_enabled"),
});
