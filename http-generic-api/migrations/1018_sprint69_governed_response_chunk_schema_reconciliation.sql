-- 1018_sprint69_governed_response_chunk_schema_reconciliation.sql
-- Purpose: reconcile pre-existing governed_tool_response_chunks tables to the durable
-- response-chunk contract and enable deny-by-default automatic reconciliation.
-- Safety: additive/idempotent; no destructive DDL; same-cycle readiness view and governed ledger evidence.
-- no_provider_call
-- no_credential_payload_read
-- no_raw_secrets
-- no_external_send
-- no_external_write
-- secrets_included=false

-- response_bytes must support large durable payloads. Already-aligned reruns are read-only.
SET @response_chunk_bytes_sql := (
  SELECT CASE
    WHEN COUNT(*) = 1
     AND MAX(data_type = 'bigint') = 1
     AND MAX(column_type LIKE 'bigint%unsigned') = 1
     AND MAX(is_nullable = 'NO') = 1
    THEN 'SELECT 1 AS governed_response_chunk_bytes_already_aligned'
    ELSE 'ALTER TABLE governed_tool_response_chunks MODIFY response_bytes BIGINT UNSIGNED NOT NULL'
  END
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'governed_tool_response_chunks'
    AND column_name = 'response_bytes'
);
PREPARE response_chunk_bytes_stmt FROM @response_chunk_bytes_sql;
EXECUTE response_chunk_bytes_stmt;
DEALLOCATE PREPARE response_chunk_bytes_stmt;

-- Cursor semantics are UTF-16 code-unit offsets because JavaScript String.slice uses them.
SET @response_chunk_cursor_sql := (
  SELECT CASE
    WHEN COUNT(*) = 1
     AND MAX(column_type = 'varchar(64)') = 1
     AND MAX(is_nullable = 'NO') = 1
     AND MAX(TRIM(BOTH '''' FROM COALESCE(column_default, '')) = 'utf16_code_unit_cursor_v1') = 1
    THEN 'SELECT 1 AS governed_response_chunk_cursor_already_aligned'
    ELSE 'ALTER TABLE governed_tool_response_chunks MODIFY cursor_policy VARCHAR(64) NOT NULL DEFAULT ''utf16_code_unit_cursor_v1'''
  END
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'governed_tool_response_chunks'
    AND column_name = 'cursor_policy'
);
PREPARE response_chunk_cursor_stmt FROM @response_chunk_cursor_sql;
EXECUTE response_chunk_cursor_stmt;
DEALLOCATE PREPARE response_chunk_cursor_stmt;

-- Add or align updated_at without replaying aligned DDL.
SET @response_chunk_updated_at_sql := (
  SELECT CASE
    WHEN COUNT(*) = 0
    THEN 'ALTER TABLE governed_tool_response_chunks ADD COLUMN updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) AFTER expires_at'
    WHEN MAX(data_type = 'datetime') = 1
     AND MAX(datetime_precision = 3) = 1
     AND MAX(is_nullable = 'NO') = 1
     AND MAX(extra LIKE '%on update CURRENT_TIMESTAMP%') = 1
    THEN 'SELECT 1 AS governed_response_chunk_updated_at_already_aligned'
    ELSE 'ALTER TABLE governed_tool_response_chunks MODIFY updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)'
  END
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'governed_tool_response_chunks'
    AND column_name = 'updated_at'
);
PREPARE response_chunk_updated_at_stmt FROM @response_chunk_updated_at_sql;
EXECUTE response_chunk_updated_at_stmt;
DEALLOCATE PREPARE response_chunk_updated_at_stmt;

-- Ensure bounded expiry cleanup remains indexed.
SET @response_chunk_expiry_index_sql := (
  SELECT CASE
    WHEN COUNT(*) > 0
    THEN 'SELECT 1 AS governed_response_chunk_expiry_index_present'
    ELSE 'ALTER TABLE governed_tool_response_chunks ADD KEY idx_governed_tool_response_chunks_expires_at (expires_at)'
  END
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'governed_tool_response_chunks'
    AND index_name = 'idx_governed_tool_response_chunks_expires_at'
);
PREPARE response_chunk_expiry_index_stmt FROM @response_chunk_expiry_index_sql;
EXECUTE response_chunk_expiry_index_stmt;
DEALLOCATE PREPARE response_chunk_expiry_index_stmt;

-- Fail closed on secret-bearing rows.
SET @response_chunk_secret_constraint_sql := (
  SELECT CASE
    WHEN COUNT(*) > 0
    THEN 'SELECT 1 AS governed_response_chunk_secret_constraint_present'
    ELSE 'ALTER TABLE governed_tool_response_chunks ADD CONSTRAINT chk_governed_tool_response_chunks_no_secrets CHECK (secrets_included = 0)'
  END
  FROM information_schema.table_constraints
  WHERE table_schema = DATABASE()
    AND table_name = 'governed_tool_response_chunks'
    AND constraint_name = 'chk_governed_tool_response_chunks_no_secrets'
);
PREPARE response_chunk_secret_constraint_stmt FROM @response_chunk_secret_constraint_sql;
EXECUTE response_chunk_secret_constraint_stmt;
DEALLOCATE PREPARE response_chunk_secret_constraint_stmt;

-- Keep durable payload integrity machine-verifiable.
SET @response_chunk_sha_constraint_sql := (
  SELECT CASE
    WHEN COUNT(*) > 0
    THEN 'SELECT 1 AS governed_response_chunk_sha_constraint_present'
    ELSE 'ALTER TABLE governed_tool_response_chunks ADD CONSTRAINT chk_governed_tool_response_chunks_sha256 CHECK (response_sha256 REGEXP ''^[0-9a-f]{64}$'')'
  END
  FROM information_schema.table_constraints
  WHERE table_schema = DATABASE()
    AND table_name = 'governed_tool_response_chunks'
    AND constraint_name = 'chk_governed_tool_response_chunks_sha256'
);
PREPARE response_chunk_sha_constraint_stmt FROM @response_chunk_sha_constraint_sql;
EXECUTE response_chunk_sha_constraint_stmt;
DEALLOCATE PREPARE response_chunk_sha_constraint_stmt;

CREATE OR REPLACE VIEW v_governed_response_chunk_schema_readiness AS
SELECT
  'governed_response_chunk_schema_v1' AS contract_key,
  metrics.required_column_count,
  metrics.aligned_column_count,
  metrics.expiry_index_count,
  metrics.required_constraint_count,
  metrics.present_constraint_count,
  CASE
    WHEN metrics.required_column_count = 3
     AND metrics.aligned_column_count = 3
     AND metrics.expiry_index_count > 0
     AND metrics.present_constraint_count = metrics.required_constraint_count
    THEN 'ready' ELSE 'blocked'
  END AS readiness_status,
  0 AS provider_calls,
  0 AS credential_payload_reads,
  0 AS external_sends,
  0 AS external_writes,
  0 AS secrets_included
FROM (
  SELECT
    3 AS required_column_count,
    (
      SELECT SUM(aligned)
      FROM (
        SELECT CASE WHEN data_type = 'bigint' AND column_type LIKE 'bigint%unsigned' AND is_nullable = 'NO' THEN 1 ELSE 0 END AS aligned
        FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = 'governed_tool_response_chunks' AND column_name = 'response_bytes'
        UNION ALL
        SELECT CASE WHEN column_type = 'varchar(64)' AND is_nullable = 'NO'
          AND TRIM(BOTH '''' FROM COALESCE(column_default, '')) = 'utf16_code_unit_cursor_v1' THEN 1 ELSE 0 END
        FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = 'governed_tool_response_chunks' AND column_name = 'cursor_policy'
        UNION ALL
        SELECT CASE WHEN data_type = 'datetime' AND datetime_precision = 3 AND is_nullable = 'NO'
          AND extra LIKE '%on update CURRENT_TIMESTAMP%' THEN 1 ELSE 0 END
        FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = 'governed_tool_response_chunks' AND column_name = 'updated_at'
      ) aligned_columns
    ) AS aligned_column_count,
    (
      SELECT COUNT(*) FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = 'governed_tool_response_chunks'
        AND index_name = 'idx_governed_tool_response_chunks_expires_at'
    ) AS expiry_index_count,
    2 AS required_constraint_count,
    (
      SELECT COUNT(*) FROM information_schema.table_constraints
      WHERE table_schema = DATABASE()
        AND table_name = 'governed_tool_response_chunks'
        AND constraint_name IN (
          'chk_governed_tool_response_chunks_no_secrets',
          'chk_governed_tool_response_chunks_sha256'
        )
    ) AS present_constraint_count
) metrics;

-- Enable internal startup/interval reconciliation. The runtime still delegates every
-- mutation to governed-migration-runner and exact DB rules; no raw SQL is executed here.
INSERT INTO platform_runtime_config
  (config_key, config_json, status, note, created_at, updated_at)
VALUES (
  'governed_migration_reconciliation_scheduler',
  JSON_OBJECT(
    'enabled', TRUE,
    'apply', TRUE,
    'migration_limit', 2000,
    'run_on_startup', TRUE,
    'scheduler_owner', 'dynamic_audit_runtime',
    'mysql_advisory_lock', 'dynamic_audit.runtime_cycle.v1',
    'raw_payload_stored', FALSE,
    'secrets_included', FALSE
  ),
  'active',
  'Automatically reconciles only exact authorized migrations with explicit active rules, passing preflight, and same-cycle readback.',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
)
ON DUPLICATE KEY UPDATE
  config_json = VALUES(config_json),
  status = VALUES(status),
  note = VALUES(note),
  updated_at = UTC_TIMESTAMP();

-- Exact rules: record the original create migration once schema exists, and apply this
-- schema alignment migration only while its readiness view is absent.
INSERT INTO platform_engine_policy_rules
  (rule_key, policy_key, engine_key, priority, task_class, resource_kind, resource_pattern,
   condition_json, strategy_key, risk_level, auto_apply_allowed, dry_run_required,
   approval_required, validator_commands_json, required_skill_keys_json, status, notes)
VALUES
  ('migration_reconcile_20260618_chunk_store_record_only',
   'governed_migration_reconciliation_v1','governed_migration_reconciliation_engine',250,
   'migration_reconcile','sql','20260618_governed_tool_response_chunks.sql',
   JSON_OBJECT('required_schema_state','complete','approved_live_reconciliation',TRUE),
   'governed_migration_record_only','medium',1,1,0,
   JSON_ARRAY('migration_preflight_pass','complete_schema_evidence'),
   JSON_ARRAY('governed_migration_reconciliation'),'active',
   'Record the original durable chunk table migration when the table already exists.'),
  ('migration_reconcile_1018_chunk_schema_apply',
   'governed_migration_reconciliation_v1','governed_migration_reconciliation_engine',260,
   'migration_reconcile','sql','1018_sprint69_governed_response_chunk_schema_reconciliation.sql',
   JSON_OBJECT('required_schema_state','incomplete','approved_live_reconciliation',TRUE,
               'readiness_view','v_governed_response_chunk_schema_readiness'),
   'governed_migration_apply','medium',1,1,0,
   JSON_ARRAY('migration_preflight_pass','post_apply_schema_readback'),
   JSON_ARRAY('governed_migration_reconciliation'),'active',
   'Apply idempotent response chunk schema alignment only while readiness evidence is incomplete.')
ON DUPLICATE KEY UPDATE
  policy_key = VALUES(policy_key),
  engine_key = VALUES(engine_key),
  priority = VALUES(priority),
  condition_json = VALUES(condition_json),
  strategy_key = VALUES(strategy_key),
  risk_level = VALUES(risk_level),
  auto_apply_allowed = VALUES(auto_apply_allowed),
  dry_run_required = VALUES(dry_run_required),
  approval_required = VALUES(approval_required),
  validator_commands_json = VALUES(validator_commands_json),
  required_skill_keys_json = VALUES(required_skill_keys_json),
  status = VALUES(status),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO governed_migration_authorization_registry
  (migration_file, authorization_status, authorization_source, policy_key, risk_tier,
   requires_preflight, requires_confirmation, allow_record_only, allow_apply, notes, metadata_json)
VALUES
  ('20260618_governed_tool_response_chunks.sql','authorized','platform_admin_review',
   'governed_migration_runner_authorization_v1','medium',1,1,1,1,
   'Authorize automatic record-only reconciliation after complete durable chunk schema readback.',
   JSON_OBJECT('scope','durable_response_chunks','automatic_reconciliation',TRUE,'secrets_included',FALSE)),
  ('1018_sprint69_governed_response_chunk_schema_reconciliation.sql','authorized','migration_seed',
   'governed_migration_runner_authorization_v1','medium',1,1,1,1,
   'Authorize idempotent response chunk schema alignment through the governed reconciler.',
   JSON_OBJECT('scope','durable_response_chunks','automatic_reconciliation',TRUE,'secrets_included',FALSE))
ON DUPLICATE KEY UPDATE
  authorization_status = VALUES(authorization_status),
  authorization_source = VALUES(authorization_source),
  policy_key = VALUES(policy_key),
  risk_tier = VALUES(risk_tier),
  requires_preflight = VALUES(requires_preflight),
  requires_confirmation = VALUES(requires_confirmation),
  allow_record_only = VALUES(allow_record_only),
  allow_apply = VALUES(allow_apply),
  notes = VALUES(notes),
  metadata_json = VALUES(metadata_json),
  updated_at = CURRENT_TIMESTAMP;
