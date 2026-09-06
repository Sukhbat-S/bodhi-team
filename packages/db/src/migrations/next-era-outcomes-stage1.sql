-- Additive staging only. No row reconciliation, current selection, or receipt correlation.
-- Run only after the reviewed baseline and verified backup/restore prerequisites.
BEGIN;
ALTER TABLE checkpoint_project_provider_refs ADD COLUMN IF NOT EXISTS is_current boolean NOT NULL DEFAULT false;
ALTER TABLE work_checkpoints ADD COLUMN IF NOT EXISTS completion_receipt_ids uuid[];
ALTER TABLE verification_receipts ADD COLUMN IF NOT EXISTS supersedes_receipt_id uuid;
ALTER TABLE verification_receipts ADD COLUMN IF NOT EXISTS subject_revision text;
CREATE UNIQUE INDEX IF NOT EXISTS checkpoint_project_provider_refs_outcome_uidx
  ON checkpoint_project_provider_refs(provider, native_task_id, project_key, checkpoint_id);
CREATE UNIQUE INDEX IF NOT EXISTS checkpoint_project_provider_refs_current_uidx
  ON checkpoint_project_provider_refs(provider, native_task_id, project_key) WHERE is_current;
CREATE UNIQUE INDEX IF NOT EXISTS verification_receipts_id_checkpoint_uidx ON verification_receipts(id, checkpoint_id);
CREATE UNIQUE INDEX IF NOT EXISTS verification_receipts_successor_uidx ON verification_receipts(supersedes_receipt_id) WHERE supersedes_receipt_id IS NOT NULL;
DO $$ BEGIN
  ALTER TABLE verification_receipts ADD CONSTRAINT verification_receipts_predecessor_checkpoint_fkey
    FOREIGN KEY (supersedes_receipt_id, checkpoint_id) REFERENCES verification_receipts(id, checkpoint_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE verification_receipts ADD CONSTRAINT verification_receipts_lineage_chk
    CHECK ((subject_revision IS NULL OR subject_revision ~ '^[a-f0-9]{64}$')
      AND (supersedes_receipt_id IS NULL OR (supersedes_receipt_id <> id AND subject_revision IS NOT NULL)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE work_checkpoints ADD CONSTRAINT work_checkpoints_completion_manifest_chk
    CHECK (state <> 'completed' OR schema_version < 3 OR
      (completion_receipt_ids IS NOT NULL AND
        ((completion_verification_state = 'not-required' AND cardinality(completion_receipt_ids) = 0)
         OR (completion_verification_state IN ('passed', 'failed') AND cardinality(completion_receipt_ids) > 0))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS skill_run_receipts_bound_uidx
  ON skill_run_receipts(provider, native_task_id, project_key, skill_name, skill_hash, checkpoint_id) WHERE checkpoint_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS skill_run_receipts_unbound_uidx
  ON skill_run_receipts(provider, native_task_id, project_key, skill_name, skill_hash) WHERE checkpoint_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS personal_opportunities_unresolved_hash_uidx
  ON personal_opportunities(project_key, content_hash) WHERE status IN ('open','accepted','in_progress','parked');
COMMIT;
