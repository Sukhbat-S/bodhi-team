-- Only after restoring the exact pre-next-era backup from the declared source
-- fingerprint. Restoring existing tables removes the additive columns, indexes
-- and attached triggers. These functions did not exist in that source baseline.
DROP FUNCTION IF EXISTS bodhi_checkpoint_immutable_v1();
DROP FUNCTION IF EXISTS bodhi_receipt_immutable_v1();
DROP FUNCTION IF EXISTS bodhi_artifact_immutable_v1();
DROP FUNCTION IF EXISTS bodhi_skill_receipt_immutable_v1();
DROP FUNCTION IF EXISTS bodhi_skill_signal_immutable_v1();
