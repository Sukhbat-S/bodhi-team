// ============================================================
// BODHI — Trust Tiers Schema (Drizzle ORM)
//
// Per-action-class trust tier table. Replaces scattered feedback_*
// memory rules with a queryable structure. The agent consults
// trust_tiers before any action with a known class:
//
//   auto-do  — execute without asking (build/test/restart/local-commit)
//   notify   — execute but flag clearly (push-branch, delete-memory)
//   await    — DO NOT execute; ask architect first (push-main, drop-table)
//
// Unknown action class: agent asks once, gets tiered, persisted forever.
//
// Phase 6.3 — bandwidth-respect mechanism, May 15, 2026.
// Root AGENTS.md is the single active authority; this table stores scoped
// action overrides in a queryable structure.
// ============================================================
import { pgTable, text, timestamp, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export type TrustTier = "auto-do" | "notify" | "await";

export const TRUST_TIERS: TrustTier[] = ["auto-do", "notify", "await"];

export const trustTiers = pgTable(
  "trust_tiers",
  {
    actionClass: text("action_class").primaryKey(),
    tier: text("tier").$type<TrustTier>().notNull(),
    setAt: timestamp("set_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    note: text("note"),
    // Actor attribution (Jul 8) — WHO set this tier. Nullable for legacy rows.
    // Vocabulary: 'architect' | 'agent:<8-hex-session>' | 'probe:<purpose>'.
    setBy: text("set_by"),
  },
  (table) => ({
    tierValid: check(
      "tier_valid",
      sql`${table.tier} IN ('auto-do', 'notify', 'await')`
    ),
  })
);
