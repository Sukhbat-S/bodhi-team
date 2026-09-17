// ============================================================
// BODHI — One-shot migration for the trust_tiers table
// Run via: npx tsx packages/db/src/migrations/apply-trust-tiers.ts
//
// Idempotent. Creates trust_tiers + seeds with the action classes
// already encoded in scattered feedback_* memories so behavior
// continuity is preserved on first deployment.
//
// Phase 6.3 — bandwidth-respect mechanism, May 15, 2026.
// ============================================================

import "dotenv/config";
import { getDb } from "../client.js";
import { sql } from "drizzle-orm";

const TABLE_DDL = `
CREATE TABLE IF NOT EXISTS trust_tiers (
  action_class text PRIMARY KEY,
  tier text NOT NULL,
  set_at timestamptz NOT NULL DEFAULT now(),
  note text,
  CONSTRAINT tier_valid CHECK (tier IN ('auto-do', 'notify', 'await'))
);
`;

const SEEDS: Array<[string, string, string]> = [
  // [action_class, tier, note]
  ["push_commit_main", "await", "Conservative fallback for unknown repos and unverified deploy-surface changes; project-specific rows take precedence"],
  ["push_commit_main_bodhi", "auto-do", "BODHI is local and single-user; verified main changes do not create a customer-facing deployment"],
  ["push_commit_branch", "notify", "Branch pushes are lower-stakes than main"],
  ["apply_supabase_migration_self_authored", "auto-do", "feedback_apply_migrations_via_mcp — apply via MCP immediately"],
  ["apply_supabase_migration_external", "await", "Externally authored migrations need explicit owner approval"],
  ["delete_memory", "notify", "Surface what's being deleted but proceed"],
  ["delete_files_repository", "notify", "Local + reversible via git; surface but proceed"],
  ["large_refactor_5plus_files", "notify", "Large local refactors require a bounded plan and notification, not a second approval gate"],
  ["restart_server_local", "auto-do", "Local server restart is reversible"],
  ["npm_install", "auto-do", "Local dep install"],
  ["npm_install_global", "await", "Global installs persist outside repo"],
  ["git_commit_local", "auto-do", "Local commits don't deploy; reversible"],
  ["mcp_read_memory", "auto-do", "Read-only operations"],
  ["mcp_search_memories", "auto-do", "Read-only"],
  ["mcp_store_memory", "auto-do", "Memory writes are non-destructive (synthesizer manages quality)"],
  // send_telegram_briefing / send_telegram_alert_urgent REMOVED 2026-07-25
  // (architect). Neither was ever consulted from code — both paths are already
  // gated upstream by the native Codex task and current trust policy
  // urgency), so the tiers were policy-surface only, re-fetched by every
  // subagent at Step 0 for no decision. Removed from the seed as well as the
  // live table, or a migration re-run would silently resurrect them.
  ["apply_research_rubric", "await", "OMEGA Phase 1.5 (Jun 15) — research-gepa-cycle POSTs an await-gated plan to apply a promoted research-verify rubric to reports/judge/research-rubric.json. The architect approves the write; the cron NEVER auto-flips the rubric."],
];

const RETIRED_ACTION_CLASSES = [
  "dispatch_subagent",
  "subagent_edit_project_code_inplace",
  "update_claude_md",
  "run_code_task",
];

async function main() {
  const db = getDb();
  console.log("[trust-tiers-migration] Connecting to DB...");
  await db.execute(sql.raw(TABLE_DDL));
  console.log("[trust-tiers-migration] trust_tiers table ensured");

  await db.execute(sql`
    DELETE FROM trust_tiers
    WHERE action_class IN (${sql.join(RETIRED_ACTION_CLASSES.map((value) => sql`${value}`), sql`, `)})
  `);
  console.log(`[trust-tiers-migration] retired ${RETIRED_ACTION_CLASSES.length} legacy action classes`);

  let inserted = 0;
  let skipped = 0;
  for (const [actionClass, tier, note] of SEEDS) {
    const safeNote = note.replace(/'/g, "''");
    const result = await db.execute(
      sql.raw(`
        INSERT INTO trust_tiers (action_class, tier, note)
        VALUES ('${actionClass}', '${tier}', '${safeNote}')
        ON CONFLICT (action_class) DO NOTHING
        RETURNING action_class
      `)
    );
    // result shape varies by driver — postgres-js returns RowList,
    // node-postgres returns { rowCount, rows }. Treat either as iterable.
    const r = result as unknown as { rowCount?: number; rows?: unknown[]; length?: number };
    const affected = r.rowCount ?? r.rows?.length ?? r.length ?? 0;
    if (affected > 0) {
      inserted++;
    } else {
      skipped++;
    }
  }
  console.log(
    `[trust-tiers-migration] Seed: ${inserted} inserted, ${skipped} already existed (preserved)`
  );
  console.log("[trust-tiers-migration] Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[trust-tiers-migration] FAILED:", err);
  process.exit(1);
});
