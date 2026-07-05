-- Governed migration ledger capability-envelope traceability.
-- Additive only: preserves existing ledger rows and records future apply envelopes
-- as first-class readback evidence without exposing secrets.

ALTER TABLE governed_migration_ledger
  ADD COLUMN IF NOT EXISTS capability_envelope_id CHAR(36) NULL AFTER mode;

CREATE INDEX IF NOT EXISTS idx_governed_migration_ledger_capability_envelope_id
  ON governed_migration_ledger (capability_envelope_id);

CREATE OR REPLACE VIEW v_migration_status_compact AS
SELECT
  migration_file,
  MAX(applied_at) AS last_applied_at,
  SUBSTRING_INDEX(GROUP_CONCAT(mode ORDER BY applied_at DESC), ',', 1) AS last_mode,
  NULLIF(SUBSTRING_INDEX(GROUP_CONCAT(COALESCE(capability_envelope_id, '') ORDER BY applied_at DESC), ',', 1), '') AS last_capability_envelope_id,
  SUBSTRING_INDEX(GROUP_CONCAT(runner_version ORDER BY applied_at DESC), ',', 1) AS last_runner_version,
  SUBSTRING_INDEX(GROUP_CONCAT(preflight_status ORDER BY applied_at DESC), ',', 1) AS last_preflight_status,
  SUBSTRING_INDEX(GROUP_CONCAT(preflight_risk_count ORDER BY applied_at DESC), ',', 1) AS last_preflight_risk_count,
  SUBSTRING_INDEX(GROUP_CONCAT(secrets_included ORDER BY applied_at DESC), ',', 1) AS last_secrets_included,
  COUNT(*) AS ledger_runs
FROM governed_migration_ledger
GROUP BY migration_file;
