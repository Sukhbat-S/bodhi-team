-- Exact writer cutover. Stop old writers and recheck the reviewed baseline first.
-- No historical data is rewritten or inferred. Rollback to old uniqueness is
-- conditional once multiple outcomes exist; never drop an outcome to downgrade.
BEGIN;
LOCK TABLE work_checkpoints, checkpoint_project_provider_refs, verification_receipts,
  checkpoint_artifacts, skill_run_receipts, skill_learning_signals IN SHARE ROW EXCLUSIVE MODE;
DROP INDEX IF EXISTS checkpoint_project_provider_refs_native_project_uidx;
DROP INDEX IF EXISTS skill_run_receipts_task_skill_hash_uidx;

CREATE OR REPLACE FUNCTION bodhi_checkpoint_immutable_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.state IN ('completed', 'abandoned') THEN
    IF TG_OP = 'DELETE' OR to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
      RAISE EXCEPTION 'terminal checkpoint is immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF OLD.schema_version >= 3 AND NEW.objective IS DISTINCT FROM OLD.objective THEN
    RAISE EXCEPTION 'outcome objective is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS bodhi_checkpoint_immutable_v1 ON work_checkpoints;
CREATE TRIGGER bodhi_checkpoint_immutable_v1 BEFORE UPDATE OR DELETE ON work_checkpoints
  FOR EACH ROW EXECUTE FUNCTION bodhi_checkpoint_immutable_v1();

CREATE OR REPLACE FUNCTION bodhi_receipt_immutable_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  RAISE EXCEPTION 'verification receipts are immutable' USING ERRCODE = '23514';
END $$;
DROP TRIGGER IF EXISTS bodhi_receipt_immutable_v1 ON verification_receipts;
CREATE TRIGGER bodhi_receipt_immutable_v1 BEFORE UPDATE OR DELETE ON verification_receipts
  FOR EACH ROW EXECUTE FUNCTION bodhi_receipt_immutable_v1();

CREATE OR REPLACE FUNCTION bodhi_artifact_immutable_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE checkpoint_state text;
BEGIN
  SELECT state INTO checkpoint_state FROM work_checkpoints WHERE id = OLD.checkpoint_id FOR UPDATE;
  IF checkpoint_state IN ('completed', 'abandoned') THEN
    RAISE EXCEPTION 'terminal checkpoint artifact is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW.checkpoint_id IS DISTINCT FROM OLD.checkpoint_id THEN
    RAISE EXCEPTION 'artifact checkpoint cannot be changed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS bodhi_artifact_immutable_v1 ON checkpoint_artifacts;
CREATE TRIGGER bodhi_artifact_immutable_v1 BEFORE UPDATE OR DELETE ON checkpoint_artifacts
  FOR EACH ROW EXECUTE FUNCTION bodhi_artifact_immutable_v1();

CREATE OR REPLACE FUNCTION bodhi_skill_receipt_immutable_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.checkpoint_id IS NOT NULL THEN
    RAISE EXCEPTION 'outcome skill receipt is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW.checkpoint_id IS NOT NULL THEN
    RAISE EXCEPTION 'unbound skill receipts cannot be assigned to later outcomes' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS bodhi_skill_receipt_immutable_v1 ON skill_run_receipts;
CREATE TRIGGER bodhi_skill_receipt_immutable_v1 BEFORE UPDATE OR DELETE ON skill_run_receipts
  FOR EACH ROW EXECUTE FUNCTION bodhi_skill_receipt_immutable_v1();

CREATE OR REPLACE FUNCTION bodhi_skill_signal_immutable_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE bound_checkpoint uuid; receipt_created timestamptz;
BEGIN
  SELECT checkpoint_id, created_at INTO bound_checkpoint, receipt_created FROM skill_run_receipts
    WHERE id = CASE WHEN TG_OP = 'INSERT' THEN NEW.receipt_id ELSE OLD.receipt_id END;
  IF bound_checkpoint IS NOT NULL AND (TG_OP <> 'INSERT' OR receipt_created <> transaction_timestamp()) THEN
    RAISE EXCEPTION 'outcome skill signals are immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS bodhi_skill_signal_immutable_v1 ON skill_learning_signals;
CREATE TRIGGER bodhi_skill_signal_immutable_v1 BEFORE INSERT OR UPDATE OR DELETE ON skill_learning_signals
  FOR EACH ROW EXECUTE FUNCTION bodhi_skill_signal_immutable_v1();
COMMIT;
