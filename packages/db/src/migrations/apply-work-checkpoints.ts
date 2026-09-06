// ============================================================
// BODHI 1.0 — additive provider-neutral checkpoint schema
// Run via:
//   npx tsx scripts/verified-migrate.ts packages/db/src/migrations/apply-work-checkpoints.ts
//
// Idempotent and additive only. Existing session/conversation tables remain
// untouched through the compatibility and archive observation window.
// ============================================================

import "dotenv/config";
import { getDb } from "../client.js";
import { sql } from "drizzle-orm";

const CHECKPOINTS_DDL = `
CREATE TABLE IF NOT EXISTS work_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_version integer NOT NULL DEFAULT 1,
  project_key text NOT NULL,
  objective text NOT NULL,
  summary text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT 'active',
  decisions jsonb NOT NULL DEFAULT '[]'::jsonb,
  next_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  entity_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  parent_checkpoint_id uuid REFERENCES work_checkpoints(id) ON DELETE SET NULL,
  remaining_work_disposition text,
  completion_verification_state text,
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT work_checkpoints_schema_version_chk CHECK (schema_version > 0),
  CONSTRAINT work_checkpoints_state_chk CHECK (state IN ('active','paused','completed','abandoned')),
  CONSTRAINT work_checkpoints_content_hash_chk CHECK (length(content_hash) = 64),
  CONSTRAINT work_checkpoints_remaining_disposition_chk CHECK (
    remaining_work_disposition IS NULL OR remaining_work_disposition IN ('none','deferred','abandoned')
  ),
  CONSTRAINT work_checkpoints_completion_verification_chk CHECK (
    completion_verification_state IS NULL OR completion_verification_state IN ('passed','failed','not-required')
  ),
  CONSTRAINT work_checkpoints_completion_fields_chk CHECK (
    state <> 'completed' OR (
      completed_at IS NOT NULL
      AND remaining_work_disposition IS NOT NULL
      AND completion_verification_state IS NOT NULL
    )
  )
);
`;

const PROVIDER_REFS_DDL = `
CREATE TABLE IF NOT EXISTS checkpoint_provider_refs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkpoint_id uuid NOT NULL REFERENCES work_checkpoints(id) ON DELETE CASCADE,
  provider text NOT NULL,
  native_task_id text NOT NULL,
  host_id text,
  working_directory text,
  task_url text,
  is_primary boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
`;

const CHECKPOINT_PROJECT_KEY_DDL = `
CREATE UNIQUE INDEX IF NOT EXISTS work_checkpoints_id_project_uidx
  ON work_checkpoints (id, project_key);
`;

const PROJECT_PROVIDER_REFS_DDL = `
CREATE TABLE IF NOT EXISTS checkpoint_project_provider_refs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkpoint_id uuid NOT NULL,
  project_key text NOT NULL,
  provider text NOT NULL,
  native_task_id text NOT NULL,
  host_id text,
  working_directory text,
  task_url text,
  is_primary boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT checkpoint_project_provider_refs_checkpoint_project_fkey
    FOREIGN KEY (checkpoint_id, project_key)
    REFERENCES work_checkpoints (id, project_key) ON DELETE CASCADE
);
`;

const ARTIFACTS_DDL = `
CREATE TABLE IF NOT EXISTS checkpoint_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkpoint_id uuid NOT NULL REFERENCES work_checkpoints(id) ON DELETE CASCADE,
  artifact_type text NOT NULL,
  uri text NOT NULL,
  label text,
  sha256 text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT checkpoint_artifacts_sha256_chk CHECK (sha256 IS NULL OR length(sha256) = 64)
);
`;

const RECEIPTS_DDL = `
CREATE TABLE IF NOT EXISTS verification_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checkpoint_id uuid NOT NULL REFERENCES work_checkpoints(id) ON DELETE CASCADE,
  claim text NOT NULL,
  expected_signal text NOT NULL,
  observed_signal text,
  evidence_source text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  observed_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT verification_receipts_status_chk CHECK (status IN ('pending','passed','failed')),
  CONSTRAINT verification_receipts_observed_signal_chk CHECK (status = 'pending' OR observed_signal IS NOT NULL)
);
`;

const INDEXES_DDL = `
CREATE INDEX IF NOT EXISTS work_checkpoints_project_state_idx
  ON work_checkpoints (project_key, state, updated_at);
CREATE INDEX IF NOT EXISTS work_checkpoints_updated_at_idx
  ON work_checkpoints (updated_at);
CREATE INDEX IF NOT EXISTS work_checkpoints_entity_ids_gin_idx
  ON work_checkpoints USING gin (entity_ids);
CREATE UNIQUE INDEX IF NOT EXISTS checkpoint_provider_refs_native_uidx
  ON checkpoint_provider_refs (provider, native_task_id);
CREATE UNIQUE INDEX IF NOT EXISTS checkpoint_provider_refs_primary_provider_uidx
  ON checkpoint_provider_refs (checkpoint_id, provider) WHERE is_primary = true;
CREATE INDEX IF NOT EXISTS checkpoint_provider_refs_checkpoint_idx
  ON checkpoint_provider_refs (checkpoint_id);
CREATE UNIQUE INDEX IF NOT EXISTS checkpoint_project_provider_refs_native_project_uidx
  ON checkpoint_project_provider_refs (provider, native_task_id, project_key);
CREATE UNIQUE INDEX IF NOT EXISTS checkpoint_project_provider_refs_primary_provider_uidx
  ON checkpoint_project_provider_refs (checkpoint_id, provider) WHERE is_primary = true;
CREATE INDEX IF NOT EXISTS checkpoint_project_provider_refs_checkpoint_idx
  ON checkpoint_project_provider_refs (checkpoint_id);
CREATE UNIQUE INDEX IF NOT EXISTS checkpoint_artifacts_checkpoint_uri_uidx
  ON checkpoint_artifacts (checkpoint_id, uri);
CREATE INDEX IF NOT EXISTS checkpoint_artifacts_checkpoint_idx
  ON checkpoint_artifacts (checkpoint_id);
CREATE INDEX IF NOT EXISTS verification_receipts_checkpoint_idx
  ON verification_receipts (checkpoint_id);
CREATE INDEX IF NOT EXISTS verification_receipts_pending_idx
  ON verification_receipts (status, observed_at);
`;

async function main() {
  const db = getDb();
  console.log("[checkpoint-migration] Connecting to DB...");
  await db.execute(sql.raw(CHECKPOINTS_DDL));
  await db.execute(sql.raw(CHECKPOINT_PROJECT_KEY_DDL));
  await db.execute(sql.raw(PROVIDER_REFS_DDL));
  await db.execute(sql.raw(PROJECT_PROVIDER_REFS_DDL));
  await db.execute(sql.raw(ARTIFACTS_DDL));
  await db.execute(sql.raw(RECEIPTS_DDL));
  await db.execute(sql.raw(INDEXES_DDL));
  console.log("[checkpoint-migration] checkpoint tables and indexes ensured");
  console.log("[checkpoint-migration] Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[checkpoint-migration] FAILED:", err);
  process.exit(1);
});
