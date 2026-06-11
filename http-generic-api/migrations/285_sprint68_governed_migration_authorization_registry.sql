-- Sprint 68: Governed migration authorization registry
-- Purpose:
--   Move governed-migration-runner authorization from a hardcoded in-code allowlist
--   into a DB-backed authorization registry. The runner may keep a legacy bootstrap
--   fallback only until this table exists.
-- Safety:
--   Additive/idempotent. No secrets. No provider execution.

CREATE TABLE IF NOT EXISTS governed_migration_authorization_registry (
  migration_file VARCHAR(255) NOT NULL PRIMARY KEY,
  authorization_status ENUM('authorized','disabled','archived') NOT NULL DEFAULT 'authorized',
  authorization_source VARCHAR(128) NOT NULL DEFAULT 'migration_seed',
  policy_key VARCHAR(191) NOT NULL DEFAULT 'governed_migration_runner_authorization_v1',
  risk_tier ENUM('low','medium','high','critical') NOT NULL DEFAULT 'low',
  requires_preflight TINYINT(1) NOT NULL DEFAULT 1,
  requires_confirmation TINYINT(1) NOT NULL DEFAULT 1,
  allow_record_only TINYINT(1) NOT NULL DEFAULT 1,
  allow_apply TINYINT(1) NOT NULL DEFAULT 1,
  notes TEXT NULL,
  metadata_json LONGTEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO governed_migration_authorization_registry
  (migration_file, authorization_status, authorization_source, policy_key, risk_tier, requires_preflight, requires_confirmation, allow_record_only, allow_apply, notes, metadata_json)
SELECT DISTINCT migration_file,
       'authorized',
       'ledger_backfill_from_governed_runner_history',
       'governed_migration_runner_authorization_v1',
       'low',
       1,
       1,
       1,
       1,
       'Authorized from governed_migration_ledger history during migration runner DB authorization bootstrap.',
       JSON_OBJECT('source_table','governed_migration_ledger','secrets_included', false)
FROM governed_migration_ledger
WHERE migration_file IS NOT NULL AND migration_file <> ''
ON DUPLICATE KEY UPDATE
  authorization_status = VALUES(authorization_status),
  authorization_source = VALUES(authorization_source),
  policy_key = VALUES(policy_key),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO governed_migration_authorization_registry
  (migration_file, authorization_status, authorization_source, policy_key, risk_tier, requires_preflight, requires_confirmation, allow_record_only, allow_apply, notes, metadata_json)
VALUES
  ('285_sprint68_governed_migration_authorization_registry.sql','authorized','bootstrap_self_seed','governed_migration_runner_authorization_v1','low',1,1,1,1,'Self-authorize the DB-backed migration authorization registry bootstrap migration.',JSON_OBJECT('bootstrap', true, 'secrets_included', false)),
  ('286_sprint68_platform_schema_contract_completion_registry.sql','authorized','platform_schema_contract_completion','governed_migration_runner_authorization_v1','low',1,1,1,1,'Authorize platform-wide schema contract completion registry persistence migration.',JSON_OBJECT('scope','schema_contract_completion','secrets_included', false))
ON DUPLICATE KEY UPDATE
  authorization_status = VALUES(authorization_status),
  authorization_source = VALUES(authorization_source),
  policy_key = VALUES(policy_key),
  notes = VALUES(notes),
  metadata_json = VALUES(metadata_json),
  updated_at = CURRENT_TIMESTAMP;
