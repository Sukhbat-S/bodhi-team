// BODHI 1.0 — additive personal direction loop.
// Run via:
//   npx tsx scripts/verified-migrate.ts packages/db/src/migrations/apply-personal-direction.ts

import "dotenv/config";
import { getDb } from "../client.js";
import { sql } from "drizzle-orm";

const TABLES_DDL = `
CREATE TABLE IF NOT EXISTS personal_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_key text NOT NULL,
  title text NOT NULL,
  outcome text NOT NULL,
  success_criteria jsonb NOT NULL DEFAULT '[]'::jsonb,
  constraints jsonb NOT NULL DEFAULT '[]'::jsonb,
  priority integer NOT NULL DEFAULT 3,
  status text NOT NULL DEFAULT 'active',
  target_date timestamptz,
  observation_scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_weekly_review_at timestamptz,
  last_quarterly_review_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT personal_goals_priority_chk CHECK (priority BETWEEN 1 AND 5),
  CONSTRAINT personal_goals_status_chk CHECK (status IN ('active','paused','completed','abandoned'))
);

CREATE TABLE IF NOT EXISTS goal_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id uuid NOT NULL REFERENCES personal_goals(id) ON DELETE CASCADE,
  cadence text NOT NULL,
  assessment text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  decisions jsonb NOT NULL DEFAULT '[]'::jsonb,
  next_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT goal_reviews_cadence_chk CHECK (cadence IN ('weekly','quarterly')),
  CONSTRAINT goal_reviews_assessment_chk CHECK (assessment IN ('on-track','at-risk','blocked','complete'))
);

CREATE TABLE IF NOT EXISTS personal_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_key text NOT NULL,
  goal_id uuid REFERENCES personal_goals(id) ON DELETE SET NULL,
  title text NOT NULL,
  observation text NOT NULL,
  why_now text NOT NULL,
  proposed_action text NOT NULL,
  expected_value text NOT NULL,
  risk text NOT NULL,
  action_class text,
  approval_required boolean NOT NULL DEFAULT true,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  content_hash text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  checkpoint_id uuid,
  parked_item_id text,
  resolution_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT personal_opportunities_value_chk CHECK (expected_value IN ('low','medium','high')),
  CONSTRAINT personal_opportunities_risk_chk CHECK (risk IN ('low','medium','high')),
  CONSTRAINT personal_opportunities_status_chk CHECK (status IN ('open','accepted','in_progress','parked','dismissed','completed')),
  CONSTRAINT personal_opportunities_hash_chk CHECK (length(content_hash) = 64)
);

CREATE TABLE IF NOT EXISTS workflow_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_key text NOT NULL,
  pattern_key text NOT NULL,
  summary text NOT NULL,
  qualifying_checkpoint_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  successful_runs integer NOT NULL,
  status text NOT NULL DEFAULT 'candidate',
  resolution_reason text,
  materialized_checkpoint_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT workflow_candidates_status_chk CHECK (status IN ('candidate','approved','dismissed','materialized')),
  CONSTRAINT workflow_candidates_runs_chk CHECK (successful_runs >= 3)
);
`;

const CHECKPOINT_DDL = `
ALTER TABLE work_checkpoints
  ADD COLUMN IF NOT EXISTS goal_id uuid,
  ADD COLUMN IF NOT EXISTS opportunity_id uuid,
  ADD COLUMN IF NOT EXISTS pattern_key text,
  ADD COLUMN IF NOT EXISTS outcome_metrics jsonb;

ALTER TABLE work_checkpoints ALTER COLUMN schema_version SET DEFAULT 2;
`;

const CONSTRAINTS_DDL = `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_checkpoints_goal_fk') THEN
    ALTER TABLE work_checkpoints ADD CONSTRAINT work_checkpoints_goal_fk
      FOREIGN KEY (goal_id) REFERENCES personal_goals(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'work_checkpoints_opportunity_fk') THEN
    ALTER TABLE work_checkpoints ADD CONSTRAINT work_checkpoints_opportunity_fk
      FOREIGN KEY (opportunity_id) REFERENCES personal_opportunities(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'personal_opportunities_checkpoint_fk') THEN
    ALTER TABLE personal_opportunities ADD CONSTRAINT personal_opportunities_checkpoint_fk
      FOREIGN KEY (checkpoint_id) REFERENCES work_checkpoints(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'personal_opportunities_parked_fk') THEN
    ALTER TABLE personal_opportunities ADD CONSTRAINT personal_opportunities_parked_fk
      FOREIGN KEY (parked_item_id) REFERENCES parked_items(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflow_candidates_materialized_checkpoint_fk') THEN
    ALTER TABLE workflow_candidates ADD CONSTRAINT workflow_candidates_materialized_checkpoint_fk
      FOREIGN KEY (materialized_checkpoint_id) REFERENCES work_checkpoints(id) ON DELETE SET NULL;
  END IF;
END $$;
`;

const INDEXES_DDL = `
CREATE INDEX IF NOT EXISTS personal_goals_project_status_idx ON personal_goals (project_key, status, priority);
CREATE INDEX IF NOT EXISTS personal_goals_review_idx ON personal_goals (last_weekly_review_at, last_quarterly_review_at);
CREATE INDEX IF NOT EXISTS goal_reviews_goal_reviewed_idx ON goal_reviews (goal_id, reviewed_at DESC);
CREATE INDEX IF NOT EXISTS personal_opportunities_project_status_idx ON personal_opportunities (project_key, status, created_at DESC);
CREATE INDEX IF NOT EXISTS personal_opportunities_goal_idx ON personal_opportunities (goal_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS personal_opportunities_checkpoint_uidx ON personal_opportunities (checkpoint_id) WHERE checkpoint_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS personal_opportunities_unresolved_hash_uidx
  ON personal_opportunities (project_key, content_hash)
  WHERE status IN ('open','accepted','in_progress','parked');
CREATE INDEX IF NOT EXISTS work_checkpoints_goal_idx ON work_checkpoints (goal_id, state, updated_at DESC);
CREATE INDEX IF NOT EXISTS work_checkpoints_opportunity_idx ON work_checkpoints (opportunity_id) WHERE opportunity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS work_checkpoints_pattern_idx ON work_checkpoints (project_key, pattern_key, state) WHERE pattern_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS workflow_candidates_project_pattern_uidx ON workflow_candidates (project_key, pattern_key);
CREATE INDEX IF NOT EXISTS workflow_candidates_status_idx ON workflow_candidates (status, updated_at DESC);
`;

async function main(): Promise<void> {
  const db = getDb();
  console.log("[personal-direction-migration] Connecting to DB...");
  await db.execute(sql.raw(TABLES_DDL));
  await db.execute(sql.raw(CHECKPOINT_DDL));
  await db.execute(sql.raw(CONSTRAINTS_DDL));
  await db.execute(sql.raw(INDEXES_DDL));
  console.log("[personal-direction-migration] direction tables, checkpoint columns, constraints, and indexes ensured");
  console.log("[personal-direction-migration] Done.");
  process.exit(0);
}

main().catch((error) => {
  console.error("[personal-direction-migration] FAILED:", error);
  process.exit(1);
});
