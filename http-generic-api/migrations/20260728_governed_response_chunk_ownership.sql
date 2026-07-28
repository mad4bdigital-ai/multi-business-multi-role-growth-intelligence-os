-- 20260728_governed_response_chunk_ownership.sql
-- Purpose: add principal ownership metadata and bounded owner indexes to governed response chunks.
-- Safety: additive/idempotent; no destructive DDL; no guessed legacy backfill; explicit approval required before apply.
-- no_provider_call
-- no_credential_payload_read
-- no_raw_secrets
-- no_external_send
-- no_external_write
-- secrets_included=false

SET @chunk_owner_tenant_sql := (
  SELECT CASE WHEN COUNT(*) = 0
    THEN 'ALTER TABLE governed_tool_response_chunks ADD COLUMN owner_tenant_id VARCHAR(64) NULL AFTER source_tool_key'
    ELSE 'SELECT 1 AS governed_chunk_owner_tenant_present' END
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'governed_tool_response_chunks' AND column_name = 'owner_tenant_id'
);
PREPARE chunk_owner_tenant_stmt FROM @chunk_owner_tenant_sql;
EXECUTE chunk_owner_tenant_stmt;
DEALLOCATE PREPARE chunk_owner_tenant_stmt;

SET @chunk_owner_user_sql := (
  SELECT CASE WHEN COUNT(*) = 0
    THEN 'ALTER TABLE governed_tool_response_chunks ADD COLUMN owner_user_id VARCHAR(64) NULL AFTER owner_tenant_id'
    ELSE 'SELECT 1 AS governed_chunk_owner_user_present' END
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'governed_tool_response_chunks' AND column_name = 'owner_user_id'
);
PREPARE chunk_owner_user_stmt FROM @chunk_owner_user_sql;
EXECUTE chunk_owner_user_stmt;
DEALLOCATE PREPARE chunk_owner_user_stmt;

SET @chunk_owner_workspace_sql := (
  SELECT CASE WHEN COUNT(*) = 0
    THEN 'ALTER TABLE governed_tool_response_chunks ADD COLUMN owner_workspace_id VARCHAR(64) NULL AFTER owner_user_id'
    ELSE 'SELECT 1 AS governed_chunk_owner_workspace_present' END
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'governed_tool_response_chunks' AND column_name = 'owner_workspace_id'
);
PREPARE chunk_owner_workspace_stmt FROM @chunk_owner_workspace_sql;
EXECUTE chunk_owner_workspace_stmt;
DEALLOCATE PREPARE chunk_owner_workspace_stmt;

SET @chunk_owner_type_sql := (
  SELECT CASE WHEN COUNT(*) = 0
    THEN 'ALTER TABLE governed_tool_response_chunks ADD COLUMN owner_principal_type VARCHAR(64) NULL AFTER owner_workspace_id'
    ELSE 'SELECT 1 AS governed_chunk_owner_type_present' END
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'governed_tool_response_chunks' AND column_name = 'owner_principal_type'
);
PREPARE chunk_owner_type_stmt FROM @chunk_owner_type_sql;
EXECUTE chunk_owner_type_stmt;
DEALLOCATE PREPARE chunk_owner_type_stmt;

SET @chunk_owner_principal_sql := (
  SELECT CASE WHEN COUNT(*) = 0
    THEN 'ALTER TABLE governed_tool_response_chunks ADD COLUMN owner_principal_id VARCHAR(191) NULL AFTER owner_principal_type'
    ELSE 'SELECT 1 AS governed_chunk_owner_principal_present' END
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'governed_tool_response_chunks' AND column_name = 'owner_principal_id'
);
PREPARE chunk_owner_principal_stmt FROM @chunk_owner_principal_sql;
EXECUTE chunk_owner_principal_stmt;
DEALLOCATE PREPARE chunk_owner_principal_stmt;

SET @chunk_source_surface_sql := (
  SELECT CASE WHEN COUNT(*) = 0
    THEN 'ALTER TABLE governed_tool_response_chunks ADD COLUMN source_surface VARCHAR(64) NULL AFTER owner_principal_id'
    ELSE 'SELECT 1 AS governed_chunk_source_surface_present' END
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'governed_tool_response_chunks' AND column_name = 'source_surface'
);
PREPARE chunk_source_surface_stmt FROM @chunk_source_surface_sql;
EXECUTE chunk_source_surface_stmt;
DEALLOCATE PREPARE chunk_source_surface_stmt;

SET @chunk_owner_user_index_sql := (
  SELECT CASE WHEN COUNT(*) > 0
    THEN 'SELECT 1 AS governed_chunk_owner_user_expiry_index_present'
    ELSE 'ALTER TABLE governed_tool_response_chunks ADD KEY idx_governed_chunk_owner_user_expiry (owner_tenant_id, owner_user_id, expires_at)'
  END
  FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'governed_tool_response_chunks'
    AND index_name = 'idx_governed_chunk_owner_user_expiry'
);
PREPARE chunk_owner_user_index_stmt FROM @chunk_owner_user_index_sql;
EXECUTE chunk_owner_user_index_stmt;
DEALLOCATE PREPARE chunk_owner_user_index_stmt;

SET @chunk_owner_principal_index_sql := (
  SELECT CASE WHEN COUNT(*) > 0
    THEN 'SELECT 1 AS governed_chunk_owner_principal_expiry_index_present'
    ELSE 'ALTER TABLE governed_tool_response_chunks ADD KEY idx_governed_chunk_principal_expiry (owner_principal_id, expires_at)'
  END
  FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'governed_tool_response_chunks'
    AND index_name = 'idx_governed_chunk_principal_expiry'
);
PREPARE chunk_owner_principal_index_stmt FROM @chunk_owner_principal_index_sql;
EXECUTE chunk_owner_principal_index_stmt;
DEALLOCATE PREPARE chunk_owner_principal_index_stmt;

CREATE OR REPLACE VIEW v_governed_response_chunk_ownership_readiness AS
SELECT
  'governed_response_chunk_ownership_v1' AS contract_key,
  metrics.required_column_count,
  metrics.present_column_count,
  metrics.required_index_count,
  metrics.present_index_count,
  CASE
    WHEN metrics.present_column_count = metrics.required_column_count
     AND metrics.present_index_count = metrics.required_index_count
    THEN 'ready' ELSE 'blocked'
  END AS readiness_status,
  0 AS legacy_rows_backfilled,
  0 AS provider_calls,
  0 AS credential_payload_reads,
  0 AS external_sends,
  0 AS external_writes,
  0 AS secrets_included
FROM (
  SELECT
    6 AS required_column_count,
    (
      SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'governed_tool_response_chunks'
        AND column_name IN (
          'owner_tenant_id','owner_user_id','owner_workspace_id',
          'owner_principal_type','owner_principal_id','source_surface'
        )
    ) AS present_column_count,
    2 AS required_index_count,
    (
      SELECT COUNT(*) FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'governed_tool_response_chunks'
        AND index_name IN (
          'idx_governed_chunk_owner_user_expiry',
          'idx_governed_chunk_principal_expiry'
        )
    ) AS present_index_count
) metrics;

INSERT INTO platform_engine_policy_rules
  (rule_key, policy_key, engine_key, priority, task_class, resource_kind, resource_pattern,
   condition_json, strategy_key, risk_level, auto_apply_allowed, dry_run_required,
   approval_required, validator_commands_json, required_skill_keys_json, status, notes)
VALUES
  ('migration_reconcile_20260728_chunk_ownership_apply',
   'governed_migration_reconciliation_v1','governed_migration_reconciliation_engine',275,
   'migration_reconcile','sql','20260728_governed_response_chunk_ownership.sql',
   JSON_OBJECT('required_schema_state','incomplete','approved_live_reconciliation',TRUE,
               'readiness_view','v_governed_response_chunk_ownership_readiness'),
   'governed_migration_apply','high',0,1,1,
   JSON_ARRAY('migration_preflight_pass','post_apply_schema_readback','ownership_columns_present','owner_indexes_present'),
   JSON_ARRAY('governed_migration_reconciliation','security_review'),'active',
   'Apply additive response chunk ownership metadata only after explicit approval; legacy rows remain ownerless and are never guessed or backfilled.')
ON DUPLICATE KEY UPDATE
  policy_key = VALUES(policy_key), engine_key = VALUES(engine_key), priority = VALUES(priority),
  condition_json = VALUES(condition_json), strategy_key = VALUES(strategy_key), risk_level = VALUES(risk_level),
  auto_apply_allowed = VALUES(auto_apply_allowed), dry_run_required = VALUES(dry_run_required),
  approval_required = VALUES(approval_required), validator_commands_json = VALUES(validator_commands_json),
  required_skill_keys_json = VALUES(required_skill_keys_json), status = VALUES(status),
  notes = VALUES(notes), updated_at = CURRENT_TIMESTAMP;

INSERT INTO governed_migration_authorization_registry
  (migration_file, authorization_status, authorization_source, policy_key, risk_tier,
   requires_preflight, requires_confirmation, allow_record_only, allow_apply, notes, metadata_json)
VALUES
  ('20260728_governed_response_chunk_ownership.sql','authorized','platform_admin_review',
   'governed_migration_runner_authorization_v1','high',1,1,1,1,
   'Authorize additive response chunk ownership schema only through governed preflight, explicit confirmation, and same-cycle readiness readback.',
   JSON_OBJECT('scope','durable_response_chunks','ownership_enforcement',TRUE,
               'legacy_backfill',FALSE,'requires_migration_first_rollout',TRUE,'secrets_included',FALSE))
ON DUPLICATE KEY UPDATE
  authorization_status = VALUES(authorization_status), authorization_source = VALUES(authorization_source),
  policy_key = VALUES(policy_key), risk_tier = VALUES(risk_tier),
  requires_preflight = VALUES(requires_preflight), requires_confirmation = VALUES(requires_confirmation),
  allow_record_only = VALUES(allow_record_only), allow_apply = VALUES(allow_apply),
  notes = VALUES(notes), metadata_json = VALUES(metadata_json), updated_at = CURRENT_TIMESTAMP;
