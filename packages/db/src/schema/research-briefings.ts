// ============================================================
// BODHI — Research-briefings schema (Drizzle ORM) — OMEGA Phase 2a, Jun 15 2026
//
// The INTERNAL Mongolian-briefing store. The mn-briefing cron
// (packages/scheduler/src/jobs/mn-briefing.ts) selects VERIFIED research_findings
// (selectBriefingFindings), generates a natural-Mongolian briefing per topic, and
// INSERTs a row here. INTERNAL-ONLY: this table + the GET /api/research-briefings
// review read are the only surfaces — the briefing is published NOWHERE (no
// Telegram / social / web). The architect (and bodhi-ui) read it from here to
// judge read-aloud quality before anything outward is ever built on top.
//
// Modeled on schema/research.ts. Migration:
//   packages/db/src/migrations/apply-research-briefings.ts (verified-migrate 6-gate).
//
//   research_briefings — one row per generated briefing.
//     topic              — the research question the briefing covers (the group key)
//     lang               — 'mn' (default); column present so a future en/ru variant
//                          needs no migration
//     title              — the parsed-off Mongolian title (first line of the body)
//     body_md            — the natural-Mongolian briefing markdown
//     source_finding_ids — the source_urls of the findings that fed this briefing
//                          (provenance — a reader can trace each claim to its source)
//     model              — the model that authored body_md (provenance)
// ============================================================

import { pgTable, uuid, text, jsonb, timestamp } from "drizzle-orm/pg-core";

export const researchBriefings = pgTable("research_briefings", {
  id: uuid("id").primaryKey().defaultRandom(),
  topic: text("topic").notNull(),
  lang: text("lang").notNull().default("mn"),
  title: text("title").notNull(),
  bodyMd: text("body_md").notNull(),
  // Despite the name, this holds source_url strings (provenance), NOT
  // research_findings.id — findings live in a kind='research' system_events
  // payload (no findings table/id to FK to). Kept as-named: the migration is
  // already applied and a RENAME is non-additive.
  sourceFindingIds: jsonb("source_finding_ids").$type<string[]>(),
  model: text("model"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
