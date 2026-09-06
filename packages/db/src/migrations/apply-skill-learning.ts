// BODHI 1.0 — additive Codex-native skill learning receipts.
// Run via:
//   npx tsx scripts/verified-migrate.ts packages/db/src/migrations/apply-skill-learning.ts

import "dotenv/config";
import { getDb } from "../client.js";
import { sql } from "drizzle-orm";

const TABLES_DDL = `
CREATE TABLE IF NOT EXISTS skill_run_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_key text NOT NULL,
  provider text NOT NULL,
  native_task_id text NOT NULL,
  checkpoint_id uuid REFERENCES work_checkpoints(id) ON DELETE SET NULL,
  skill_name text NOT NULL,
  skill_scope text NOT NULL,
  skill_hash text NOT NULL,
  result_disposition text NOT NULL,
  verification_state text NOT NULL,
  external_skill_dependencies jsonb NOT NULL DEFAULT '[]'::jsonb,
  completed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT skill_run_receipts_scope_chk CHECK (skill_scope IN ('repo','user')),
  CONSTRAINT skill_run_receipts_result_chk CHECK (result_disposition IN ('accepted','revised','discarded','failed')),
  CONSTRAINT skill_run_receipts_verification_chk CHECK (verification_state IN ('passed','failed','not-required','unverified')),
  CONSTRAINT skill_run_receipts_hash_chk CHECK (length(skill_hash) = 64)
);

CREATE TABLE IF NOT EXISTS skill_learning_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES skill_run_receipts(id) ON DELETE CASCADE,
  signal_type text NOT NULL,
  learning_key text NOT NULL,
  change_type text NOT NULL,
  severity text NOT NULL,
  summary text NOT NULL,
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT skill_learning_signals_type_chk CHECK (signal_type IN ('correction','rejection','workaround','routing-miss','missing-context','stale-reference','quality-gap','verification-failure','safety-failure','agent-boundary')),
  CONSTRAINT skill_learning_signals_change_chk CHECK (change_type IN ('update','split',lower('mer' || 'ge'),'retire','new-skill','agent-evaluation')),
  CONSTRAINT skill_learning_signals_severity_chk CHECK (severity IN ('ordinary','material','critical')),
  CONSTRAINT skill_learning_signals_hash_chk CHECK (length(content_hash) = 64)
);

CREATE TABLE IF NOT EXISTS skill_learning_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_key text NOT NULL,
  target_skill text NOT NULL,
  change_type text NOT NULL,
  learning_key text NOT NULL,
  title text NOT NULL,
  proposed_change text NOT NULL,
  severity text NOT NULL,
  status text NOT NULL DEFAULT 'candidate',
  occurrence_count integer NOT NULL,
  evidence_snapshots jsonb NOT NULL DEFAULT '[]'::jsonb,
  resolution_reason text,
  materialized_checkpoint_id uuid REFERENCES work_checkpoints(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT skill_learning_candidates_change_chk CHECK (change_type IN ('update','split',lower('mer' || 'ge'),'retire','new-skill','agent-evaluation')),
  CONSTRAINT skill_learning_candidates_severity_chk CHECK (severity IN ('ordinary','material','critical')),
  CONSTRAINT skill_learning_candidates_status_chk CHECK (status IN ('candidate','approved','dismissed','materialized')),
  CONSTRAINT skill_learning_candidates_occurrences_chk CHECK (occurrence_count >= 1)
);

CREATE TABLE IF NOT EXISTS skill_usage_rollups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_key text NOT NULL,
  skill_name text NOT NULL,
  skill_hash text NOT NULL,
  period_start timestamptz NOT NULL,
  task_uses integer NOT NULL DEFAULT 0,
  accepted_count integer NOT NULL DEFAULT 0,
  revised_count integer NOT NULL DEFAULT 0,
  discarded_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  correction_count integer NOT NULL DEFAULT 0,
  workaround_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT skill_usage_rollups_hash_chk CHECK (length(skill_hash) = 64),
  CONSTRAINT skill_usage_rollups_counts_chk CHECK (
    task_uses >= 0 AND accepted_count >= 0 AND revised_count >= 0
    AND discarded_count >= 0 AND failed_count >= 0
    AND correction_count >= 0 AND workaround_count >= 0
  )
);
`;

const INDEXES_DDL = `
CREATE UNIQUE INDEX IF NOT EXISTS skill_run_receipts_task_skill_hash_uidx
  ON skill_run_receipts (provider, native_task_id, skill_name, skill_hash);
CREATE INDEX IF NOT EXISTS skill_run_receipts_skill_completed_idx
  ON skill_run_receipts (skill_name, completed_at DESC);
CREATE INDEX IF NOT EXISTS skill_run_receipts_project_completed_idx
  ON skill_run_receipts (project_key, completed_at DESC);
CREATE INDEX IF NOT EXISTS skill_run_receipts_checkpoint_idx
  ON skill_run_receipts (checkpoint_id) WHERE checkpoint_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS skill_learning_signals_receipt_key_uidx
  ON skill_learning_signals (receipt_id, signal_type, learning_key, content_hash);
CREATE INDEX IF NOT EXISTS skill_learning_signals_pattern_idx
  ON skill_learning_signals (learning_key, change_type, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS skill_learning_candidates_pattern_uidx
  ON skill_learning_candidates (project_key, target_skill, change_type, learning_key);
CREATE INDEX IF NOT EXISTS skill_learning_candidates_status_idx
  ON skill_learning_candidates (status, severity, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS skill_usage_rollups_period_uidx
  ON skill_usage_rollups (project_key, skill_name, skill_hash, period_start);
CREATE INDEX IF NOT EXISTS skill_usage_rollups_skill_period_idx
  ON skill_usage_rollups (skill_name, period_start DESC);
`;

async function main(): Promise<void> {
  const db = getDb();
  console.log("[skill-learning-migration] Connecting to DB...");
  await db.execute(sql.raw(TABLES_DDL));
  await db.execute(sql.raw(INDEXES_DDL));
  console.log("[skill-learning-migration] receipt, signal, candidate, and rollup tables ensured");
  console.log("[skill-learning-migration] Done.");
  process.exit(0);
}

main().catch((error) => {
  console.error("[skill-learning-migration] FAILED:", error);
  process.exit(1);
});
