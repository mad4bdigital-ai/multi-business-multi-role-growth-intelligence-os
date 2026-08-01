-- spec014_hostinger_storage_readback.sql
-- DRAFT SAME-CYCLE READBACK; specification-local and not runnable by governed-migration-runner.
-- Task: T027
-- migration_apply_authorized=false
-- schema_verified=false
-- production_ready=false
-- signed_schema_verification_required=true
-- no_provider_call
-- no_credential_payload_read
-- no_raw_secrets
-- no_external_send
-- no_external_write
-- secrets_included=false

WITH expected_tables AS (
  SELECT 'storage_provider_accounts' AS object_name
  UNION ALL SELECT 'storage_targets'
  UNION ALL SELECT 'storage_target_bindings'
  UNION ALL SELECT 'storage_pressure_snapshots'
  UNION ALL SELECT 'storage_cleanup_operations'
  UNION ALL SELECT 'storage_cleanup_plans'
  UNION ALL SELECT 'storage_cleanup_plan_items'
  UNION ALL SELECT 'storage_cleanup_plan_impacts'
  UNION ALL SELECT 'storage_cleanup_approvals'
  UNION ALL SELECT 'storage_execution_leases'
  UNION ALL SELECT 'storage_cleanup_runs'
  UNION ALL SELECT 'storage_cleanup_run_items'
  UNION ALL SELECT 'storage_reconciliation_results'
  UNION ALL SELECT 'storage_emergency_reserves'
  UNION ALL SELECT 'storage_pressure_incidents'
),
expected_views AS (
  SELECT 'v_storage_admin_target_readiness' AS object_name
  UNION ALL SELECT 'v_storage_tenant_target_readiness'
  UNION ALL SELECT 'v_storage_cleanup_operation_readback'
)
SELECT
  (SELECT COUNT(*) FROM expected_tables) AS expected_table_count,
  (SELECT COUNT(*) FROM information_schema.tables t
    JOIN expected_tables e ON e.object_name = t.table_name
    WHERE t.table_schema = DATABASE()
      AND t.table_type = 'BASE TABLE'
      AND t.engine = 'InnoDB'
      AND t.table_collation = 'utf8mb4_unicode_ci') AS compatible_table_count,
  (SELECT COUNT(*) FROM expected_views) AS expected_view_count,
  (SELECT COUNT(*) FROM information_schema.views v
    JOIN expected_views e ON e.object_name = v.table_name
    WHERE v.table_schema = DATABASE()) AS present_view_count,
  CASE
    WHEN (SELECT COUNT(*) FROM information_schema.tables t
      JOIN expected_tables e ON e.object_name = t.table_name
      WHERE t.table_schema = DATABASE()
        AND t.table_type = 'BASE TABLE'
        AND t.engine = 'InnoDB'
        AND t.table_collation = 'utf8mb4_unicode_ci') = 15
     AND (SELECT COUNT(*) FROM information_schema.views v
      JOIN expected_views e ON e.object_name = v.table_name
      WHERE v.table_schema = DATABASE()) = 3
    THEN 'ready_for_column_index_constraint_readback'
    ELSE 'blocked'
  END AS object_readiness_status,
  0 AS secrets_included;

WITH expected_runtime_columns AS (
  SELECT 'storage_cleanup_operations' AS table_name, 'id' AS column_name, 'char' AS data_type
  UNION ALL SELECT 'storage_cleanup_operations', 'idempotency_key', 'char'
  UNION ALL SELECT 'storage_cleanup_operations', 'target_id', 'char'
  UNION ALL SELECT 'storage_cleanup_operations', 'state', 'varchar'
  UNION ALL SELECT 'storage_cleanup_operations', 'version', 'bigint'
  UNION ALL SELECT 'storage_cleanup_operations', 'record_digest', 'char'
  UNION ALL SELECT 'storage_cleanup_operations', 'record_json', 'json'
  UNION ALL SELECT 'storage_cleanup_operations', 'row_version', 'bigint'
  UNION ALL SELECT 'storage_cleanup_plans', 'id', 'char'
  UNION ALL SELECT 'storage_cleanup_plans', 'operation_id', 'char'
  UNION ALL SELECT 'storage_cleanup_plans', 'target_id', 'char'
  UNION ALL SELECT 'storage_cleanup_plans', 'plan_hash', 'char'
  UNION ALL SELECT 'storage_cleanup_plans', 'consumed', 'tinyint'
  UNION ALL SELECT 'storage_cleanup_plans', 'record_digest', 'char'
  UNION ALL SELECT 'storage_cleanup_plans', 'record_json', 'json'
  UNION ALL SELECT 'storage_cleanup_plans', 'row_version', 'bigint'
  UNION ALL SELECT 'storage_cleanup_approvals', 'id', 'char'
  UNION ALL SELECT 'storage_cleanup_approvals', 'plan_id', 'char'
  UNION ALL SELECT 'storage_cleanup_approvals', 'approval_slot', 'varchar'
  UNION ALL SELECT 'storage_cleanup_approvals', 'decision', 'varchar'
  UNION ALL SELECT 'storage_cleanup_approvals', 'invalidated', 'tinyint'
  UNION ALL SELECT 'storage_cleanup_approvals', 'record_digest', 'char'
  UNION ALL SELECT 'storage_cleanup_approvals', 'record_json', 'json'
  UNION ALL SELECT 'storage_cleanup_approvals', 'row_version', 'bigint'
  UNION ALL SELECT 'storage_execution_leases', 'target_id', 'char'
  UNION ALL SELECT 'storage_execution_leases', 'lease_id', 'char'
  UNION ALL SELECT 'storage_execution_leases', 'operation_id', 'char'
  UNION ALL SELECT 'storage_execution_leases', 'generation', 'bigint'
  UNION ALL SELECT 'storage_execution_leases', 'status', 'varchar'
  UNION ALL SELECT 'storage_execution_leases', 'expires_at_epoch', 'bigint'
  UNION ALL SELECT 'storage_execution_leases', 'record_digest', 'char'
  UNION ALL SELECT 'storage_execution_leases', 'record_json', 'json'
  UNION ALL SELECT 'storage_execution_leases', 'row_version', 'bigint'
  UNION ALL SELECT 'storage_cleanup_run_items', 'id', 'char'
  UNION ALL SELECT 'storage_cleanup_run_items', 'operation_id', 'char'
  UNION ALL SELECT 'storage_cleanup_run_items', 'run_id', 'char'
  UNION ALL SELECT 'storage_cleanup_run_items', 'plan_id', 'char'
  UNION ALL SELECT 'storage_cleanup_run_items', 'item_id', 'varchar'
  UNION ALL SELECT 'storage_cleanup_run_items', 'sequence', 'bigint'
  UNION ALL SELECT 'storage_cleanup_run_items', 'phase', 'varchar'
  UNION ALL SELECT 'storage_cleanup_run_items', 'result', 'varchar'
  UNION ALL SELECT 'storage_cleanup_run_items', 'record_digest', 'char'
  UNION ALL SELECT 'storage_cleanup_run_items', 'record_json', 'json'
  UNION ALL SELECT 'storage_cleanup_run_items', 'row_version', 'bigint'
  UNION ALL SELECT 'storage_reconciliation_results', 'id', 'char'
  UNION ALL SELECT 'storage_reconciliation_results', 'operation_id', 'char'
  UNION ALL SELECT 'storage_reconciliation_results', 'run_id', 'char'
  UNION ALL SELECT 'storage_reconciliation_results', 'outcome', 'varchar'
  UNION ALL SELECT 'storage_reconciliation_results', 'retry_permission', 'tinyint'
  UNION ALL SELECT 'storage_reconciliation_results', 'record_digest', 'char'
  UNION ALL SELECT 'storage_reconciliation_results', 'record_json', 'json'
  UNION ALL SELECT 'storage_reconciliation_results', 'row_version', 'bigint'
)
SELECT
  COUNT(*) AS expected_runtime_column_count,
  SUM(c.column_name IS NOT NULL AND c.data_type = e.data_type) AS compatible_runtime_column_count,
  SUM(c.column_name IS NULL) AS missing_runtime_column_count,
  SUM(c.column_name IS NOT NULL AND c.data_type <> e.data_type) AS incompatible_runtime_column_count,
  CASE
    WHEN SUM(c.column_name IS NOT NULL AND c.data_type = e.data_type) = COUNT(*)
    THEN 'ready'
    ELSE 'blocked'
  END AS runtime_column_readback_status,
  0 AS secrets_included
FROM expected_runtime_columns e
LEFT JOIN information_schema.columns c
  ON c.table_schema = DATABASE()
 AND c.table_name = e.table_name
 AND c.column_name = e.column_name;

WITH expected_runtime_columns AS (
  SELECT 'storage_cleanup_operations' AS table_name, 'id' AS column_name, 'char' AS data_type
  UNION ALL SELECT 'storage_cleanup_operations', 'idempotency_key', 'char'
  UNION ALL SELECT 'storage_cleanup_operations', 'target_id', 'char'
  UNION ALL SELECT 'storage_cleanup_operations', 'state', 'varchar'
  UNION ALL SELECT 'storage_cleanup_operations', 'version', 'bigint'
  UNION ALL SELECT 'storage_cleanup_operations', 'record_digest', 'char'
  UNION ALL SELECT 'storage_cleanup_operations', 'record_json', 'json'
  UNION ALL SELECT 'storage_cleanup_operations', 'row_version', 'bigint'
  UNION ALL SELECT 'storage_cleanup_plans', 'id', 'char'
  UNION ALL SELECT 'storage_cleanup_plans', 'operation_id', 'char'
  UNION ALL SELECT 'storage_cleanup_plans', 'target_id', 'char'
  UNION ALL SELECT 'storage_cleanup_plans', 'plan_hash', 'char'
  UNION ALL SELECT 'storage_cleanup_plans', 'consumed', 'tinyint'
  UNION ALL SELECT 'storage_cleanup_plans', 'record_digest', 'char'
  UNION ALL SELECT 'storage_cleanup_plans', 'record_json', 'json'
  UNION ALL SELECT 'storage_cleanup_plans', 'row_version', 'bigint'
  UNION ALL SELECT 'storage_cleanup_approvals', 'id', 'char'
  UNION ALL SELECT 'storage_cleanup_approvals', 'plan_id', 'char'
  UNION ALL SELECT 'storage_cleanup_approvals', 'approval_slot', 'varchar'
  UNION ALL SELECT 'storage_cleanup_approvals', 'decision', 'varchar'
  UNION ALL SELECT 'storage_cleanup_approvals', 'invalidated', 'tinyint'
  UNION ALL SELECT 'storage_cleanup_approvals', 'record_digest', 'char'
  UNION ALL SELECT 'storage_cleanup_approvals', 'record_json', 'json'
  UNION ALL SELECT 'storage_cleanup_approvals', 'row_version', 'bigint'
  UNION ALL SELECT 'storage_execution_leases', 'target_id', 'char'
  UNION ALL SELECT 'storage_execution_leases', 'lease_id', 'char'
  UNION ALL SELECT 'storage_execution_leases', 'operation_id', 'char'
  UNION ALL SELECT 'storage_execution_leases', 'generation', 'bigint'
  UNION ALL SELECT 'storage_execution_leases', 'status', 'varchar'
  UNION ALL SELECT 'storage_execution_leases', 'expires_at_epoch', 'bigint'
  UNION ALL SELECT 'storage_execution_leases', 'record_digest', 'char'
  UNION ALL SELECT 'storage_execution_leases', 'record_json', 'json'
  UNION ALL SELECT 'storage_execution_leases', 'row_version', 'bigint'
  UNION ALL SELECT 'storage_cleanup_run_items', 'id', 'char'
  UNION ALL SELECT 'storage_cleanup_run_items', 'operation_id', 'char'
  UNION ALL SELECT 'storage_cleanup_run_items', 'run_id', 'char'
  UNION ALL SELECT 'storage_cleanup_run_items', 'plan_id', 'char'
  UNION ALL SELECT 'storage_cleanup_run_items', 'item_id', 'varchar'
  UNION ALL SELECT 'storage_cleanup_run_items', 'sequence', 'bigint'
  UNION ALL SELECT 'storage_cleanup_run_items', 'phase', 'varchar'
  UNION ALL SELECT 'storage_cleanup_run_items', 'result', 'varchar'
  UNION ALL SELECT 'storage_cleanup_run_items', 'record_digest', 'char'
  UNION ALL SELECT 'storage_cleanup_run_items', 'record_json', 'json'
  UNION ALL SELECT 'storage_cleanup_run_items', 'row_version', 'bigint'
  UNION ALL SELECT 'storage_reconciliation_results', 'id', 'char'
  UNION ALL SELECT 'storage_reconciliation_results', 'operation_id', 'char'
  UNION ALL SELECT 'storage_reconciliation_results', 'run_id', 'char'
  UNION ALL SELECT 'storage_reconciliation_results', 'outcome', 'varchar'
  UNION ALL SELECT 'storage_reconciliation_results', 'retry_permission', 'tinyint'
  UNION ALL SELECT 'storage_reconciliation_results', 'record_digest', 'char'
  UNION ALL SELECT 'storage_reconciliation_results', 'record_json', 'json'
  UNION ALL SELECT 'storage_reconciliation_results', 'row_version', 'bigint'
)
SELECT
  e.table_name,
  e.column_name,
  e.data_type AS expected_data_type,
  c.data_type AS observed_data_type,
  c.column_type,
  c.is_nullable,
  c.column_default,
  c.extra,
  CASE WHEN c.column_name IS NOT NULL AND c.data_type = e.data_type
       THEN 'ready' ELSE 'blocked' END AS column_status
FROM expected_runtime_columns e
LEFT JOIN information_schema.columns c
  ON c.table_schema = DATABASE()
 AND c.table_name = e.table_name
 AND c.column_name = e.column_name
ORDER BY e.table_name, e.column_name;

WITH expected_runtime_indexes AS (
  SELECT 'storage_cleanup_operations' AS table_name, 'PRIMARY' AS index_name, 'id' AS column_name, 1 AS seq_in_index
  UNION ALL SELECT 'storage_cleanup_operations', 'uq_storage_cleanup_operations_idempotency', 'operation_class', 1
  UNION ALL SELECT 'storage_cleanup_operations', 'uq_storage_cleanup_operations_idempotency', 'target_id', 2
  UNION ALL SELECT 'storage_cleanup_operations', 'uq_storage_cleanup_operations_idempotency', 'idempotency_key', 3
  UNION ALL SELECT 'storage_cleanup_plans', 'PRIMARY', 'id', 1
  UNION ALL SELECT 'storage_cleanup_plans', 'uq_storage_cleanup_plans_operation_hash', 'operation_id', 1
  UNION ALL SELECT 'storage_cleanup_plans', 'uq_storage_cleanup_plans_operation_hash', 'plan_hash', 2
  UNION ALL SELECT 'storage_cleanup_approvals', 'PRIMARY', 'id', 1
  UNION ALL SELECT 'storage_cleanup_approvals', 'uq_storage_cleanup_approvals_generation', 'plan_id', 1
  UNION ALL SELECT 'storage_cleanup_approvals', 'uq_storage_cleanup_approvals_generation', 'approval_slot', 2
  UNION ALL SELECT 'storage_cleanup_approvals', 'uq_storage_cleanup_approvals_generation', 'approval_generation', 3
  UNION ALL SELECT 'storage_execution_leases', 'PRIMARY', 'target_id', 1
  UNION ALL SELECT 'storage_execution_leases', 'uq_storage_execution_leases_active', 'target_id', 1
  UNION ALL SELECT 'storage_execution_leases', 'uq_storage_execution_leases_active', 'root_ref_digest', 2
  UNION ALL SELECT 'storage_execution_leases', 'uq_storage_execution_leases_active', 'active_slot', 3
  UNION ALL SELECT 'storage_cleanup_run_items', 'PRIMARY', 'id', 1
  UNION ALL SELECT 'storage_cleanup_run_items', 'uq_storage_cleanup_run_items_sequence', 'run_id', 1
  UNION ALL SELECT 'storage_cleanup_run_items', 'uq_storage_cleanup_run_items_sequence', 'plan_item_id', 2
  UNION ALL SELECT 'storage_cleanup_run_items', 'uq_storage_cleanup_run_items_sequence', 'sequence', 3
  UNION ALL SELECT 'storage_reconciliation_results', 'PRIMARY', 'id', 1
  UNION ALL SELECT 'storage_reconciliation_results', 'uq_storage_reconciliation_generation', 'run_id', 1
  UNION ALL SELECT 'storage_reconciliation_results', 'uq_storage_reconciliation_generation', 'reconciliation_generation', 2
)
SELECT
  COUNT(*) AS expected_runtime_index_column_count,
  SUM(s.index_name IS NOT NULL
      AND s.column_name = e.column_name
      AND s.seq_in_index = e.seq_in_index) AS compatible_runtime_index_column_count,
  CASE
    WHEN SUM(s.index_name IS NOT NULL
             AND s.column_name = e.column_name
             AND s.seq_in_index = e.seq_in_index) = COUNT(*)
    THEN 'ready'
    ELSE 'blocked'
  END AS runtime_index_readback_status,
  0 AS secrets_included
FROM expected_runtime_indexes e
LEFT JOIN information_schema.statistics s
  ON s.table_schema = DATABASE()
 AND s.table_name = e.table_name
 AND s.index_name = e.index_name
 AND s.seq_in_index = e.seq_in_index;

SELECT
  table_name,
  constraint_type,
  COUNT(*) AS constraint_count
FROM information_schema.table_constraints
WHERE table_schema = DATABASE()
  AND table_name LIKE 'storage\\_%'
GROUP BY table_name, constraint_type
ORDER BY table_name, constraint_type;

SELECT
  COUNT(*) AS expected_default_off_tool_count,
  SUM(is_enabled = 0) AS disabled_tool_count,
  SUM(is_enabled <> 0) AS enabled_tool_count,
  CASE
    WHEN COUNT(*) = 3 AND SUM(is_enabled = 0) = 3 THEN 'ready_default_off'
    ELSE 'blocked'
  END AS tool_seed_readback_status,
  0 AS secrets_included
FROM admin_platform_endpoint_tools
WHERE tool_key IN (
  'hostinger_storage_snapshot_read',
  'hostinger_storage_plan_inspect',
  'hostinger_storage_plan_apply'
);

SELECT
  tool_key,
  is_enabled,
  CASE WHEN is_enabled = 0 THEN 'ready_default_off' ELSE 'blocked_tool_enabled' END AS seed_status
FROM admin_platform_endpoint_tools
WHERE tool_key IN (
  'hostinger_storage_snapshot_read',
  'hostinger_storage_plan_inspect',
  'hostinger_storage_plan_apply'
)
ORDER BY tool_key;

SELECT
  'spec014_hostinger_storage_migration_readback_v2' AS contract_key,
  'candidate_only_unsigned' AS schema_verification_status,
  0 AS production_ready,
  0 AS provider_calls,
  0 AS credential_payload_reads,
  0 AS external_sends,
  0 AS external_writes,
  0 AS secrets_included;
