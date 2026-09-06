// ============================================================
// BODHI — Agent substrate (Wave 10, May 24, 2026)
// Run via: npx tsx packages/db/src/migrations/apply-agent-dispatches.ts
//
// Closes the Loop 3 gap [[pattern_three_loop_attunement_model_may21]]:
// agents compound per-architect just as the architect compounds per-
// experience. Without this table, every subagent dispatch is greenfield
// — bodhi-crit re-derives the same god-file findings, bodhi-design
// re-discovers the same palette drift, bodhi-security re-finds the same
// 'both' semantic risk. The substrate compounded everywhere except the
// agent layer.
//
// This table is the agent layer's substrate. Bidirectional:
//   - WRITE: parent-Claude parses each subagent's `## Findings to persist`
//     section after Agent tool returns, inserts a row here.
//   - READ: legacy archive tooling only
//     for the dispatched agent identity back into its context.
//
// Historical Wave 10 migration; the runtime capability is retired.
// + AGENTS.md §4 (Attunement) + SUBSTRATE.md §1 (substrate definition).
//
// Idempotent.
// ============================================================

import "dotenv/config";
import { getDb } from "../client.js";
import { sql } from "drizzle-orm";

const TABLE_DDL = `
CREATE TABLE IF NOT EXISTS agent_dispatches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name      text NOT NULL,
  dispatched_at   timestamptz NOT NULL DEFAULT now(),
  dispatched_by   text,
  task_prompt     text NOT NULL,
  task_output     text NOT NULL,
  findings        jsonb,
  tool_calls      jsonb,
  tokens_in       integer,
  tokens_out      integer,
  duration_ms     integer,
  model           text,
  feedback        jsonb,
  archived_at     timestamptz
);
`;

const INDEX_AGENT_TS_DDL = `
CREATE INDEX IF NOT EXISTS agent_dispatches_agent_ts_idx
  ON agent_dispatches (agent_name, dispatched_at DESC);
`;

const INDEX_TS_DDL = `
CREATE INDEX IF NOT EXISTS agent_dispatches_ts_idx
  ON agent_dispatches (dispatched_at DESC);
`;

const INDEX_DISPATCHED_BY_DDL = `
CREATE INDEX IF NOT EXISTS agent_dispatches_dispatched_by_idx
  ON agent_dispatches (dispatched_by)
  WHERE dispatched_by IS NOT NULL;
`;

const INDEX_FINDINGS_GIN_DDL = `
CREATE INDEX IF NOT EXISTS agent_dispatches_findings_gin_idx
  ON agent_dispatches USING gin (findings);
`;

const INDEX_ARCHIVED_DDL = `
CREATE INDEX IF NOT EXISTS agent_dispatches_active_idx
  ON agent_dispatches (agent_name, dispatched_at DESC)
  WHERE archived_at IS NULL;
`;

async function main(): Promise<void> {
  const db = getDb();
  console.log("[apply-agent-dispatches] Connecting...");

  await db.execute(sql.raw(TABLE_DDL));
  console.log("[apply-agent-dispatches] table ensured");

  await db.execute(sql.raw(INDEX_AGENT_TS_DDL));
  await db.execute(sql.raw(INDEX_TS_DDL));
  await db.execute(sql.raw(INDEX_DISPATCHED_BY_DDL));
  await db.execute(sql.raw(INDEX_FINDINGS_GIN_DDL));
  await db.execute(sql.raw(INDEX_ARCHIVED_DDL));
  console.log("[apply-agent-dispatches] indexes ensured");

  console.log("[apply-agent-dispatches] Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[apply-agent-dispatches] FAILED:", err);
  process.exit(1);
});
