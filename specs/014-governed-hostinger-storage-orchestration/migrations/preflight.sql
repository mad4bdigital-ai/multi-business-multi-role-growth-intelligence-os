-- spec014_hostinger_storage_preflight.sql
-- DRAFT READ-ONLY PREFLIGHT; specification-local and not runnable by governed-migration-runner.
-- Task: T027
-- migration_apply_authorized=false
-- schema_verified=false
-- production_ready=false
-- no_provider_call
-- no_credential_payload_read
-- no_raw_secrets
-- no_external_send
-- no_external_write
-- secrets_included=false

WITH expected_objects AS (
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
)
SELECT
  e.object_name,
  CASE
    WHEN t.table_name IS NULL THEN 'absent_ready_for_additive_create'
    WHEN t.table_type = 'BASE TABLE'
     AND t.engine = 'InnoDB'
     AND t.table_collation = 'utf8mb4_unicode_ci'
      THEN 'existing_requires_exact_contract_readback'
    ELSE 'blocked_incompatible_existing_object'
  END AS preflight_status,
  t.table_type,
  t.engine,
  t.table_collation
FROM expected_objects e
LEFT JOIN information_schema.tables t
  ON t.table_schema = DATABASE()
 AND t.table_name = e.object_name
ORDER BY e.object_name;

WITH required_parents AS (
  SELECT 'tenants' AS table_name, 'id' AS column_name
  UNION ALL SELECT 'workspaces', 'id'
  UNION ALL SELECT 'platform_resources', 'id'
)
SELECT
  p.table_name,
  p.column_name,
  c.column_type,
  c.character_set_name,
  c.collation_name,
  CASE
    WHEN c.column_name IS NULL THEN 'blocked_missing_parent'
    WHEN c.data_type NOT IN ('char', 'varchar') THEN 'blocked_parent_type'
    WHEN c.character_set_name <> 'utf8mb4' THEN 'blocked_parent_charset'
    WHEN c.collation_name <> 'utf8mb4_unicode_ci' THEN 'blocked_parent_collation'
    ELSE 'ready_for_exact_external_fk_generation'
  END AS parent_readback_status
FROM required_parents p
LEFT JOIN information_schema.columns c
  ON c.table_schema = DATABASE()
 AND c.table_name = p.table_name
 AND c.column_name = p.column_name
ORDER BY p.table_name;

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
  c.column_type AS observed_column_type,
  c.is_nullable,
  c.column_default,
  c.extra,
  CASE
    WHEN t.table_name IS NULL THEN 'pending_additive_create'
    WHEN c.column_name IS NULL THEN 'blocked_missing_runtime_column'
    WHEN c.data_type <> e.data_type THEN 'blocked_runtime_column_type'
    ELSE 'ready'
  END AS runtime_column_status
FROM expected_runtime_columns e
LEFT JOIN information_schema.tables t
  ON t.table_schema = DATABASE()
 AND t.table_name = e.table_name
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
  e.table_name,
  e.index_name,
  e.column_name,
  e.seq_in_index,
  s.column_name AS observed_column_name,
  s.seq_in_index AS observed_seq_in_index,
  CASE
    WHEN t.table_name IS NULL THEN 'pending_additive_create'
    WHEN s.index_name IS NULL THEN 'blocked_missing_runtime_index_column'
    WHEN s.column_name <> e.column_name OR s.seq_in_index <> e.seq_in_index
      THEN 'blocked_runtime_index_order'
    ELSE 'ready'
  END AS runtime_index_status
FROM expected_runtime_indexes e
LEFT JOIN information_schema.tables t
  ON t.table_schema = DATABASE()
 AND t.table_name = e.table_name
LEFT JOIN information_schema.statistics s
  ON s.table_schema = DATABASE()
 AND s.table_name = e.table_name
 AND s.index_name = e.index_name
 AND s.seq_in_index = e.seq_in_index
ORDER BY e.table_name, e.index_name, e.seq_in_index;

WITH required_tool_columns AS (
  SELECT 'tool_key' AS column_name
  UNION ALL SELECT 'display_name'
  UNION ALL SELECT 'description'
  UNION ALL SELECT 'http_method'
  UNION ALL SELECT 'http_path'
  UNION ALL SELECT 'path_param_keys'
  UNION ALL SELECT 'input_schema'
  UNION ALL SELECT 'fixed_body'
  UNION ALL SELECT 'tags'
  UNION ALL SELECT 'is_enabled'
  UNION ALL SELECT 'sort_order'
)
SELECT
  e.column_name,
  c.data_type,
  c.column_type,
  CASE
    WHEN t.table_name IS NULL THEN 'blocked_missing_tool_registry'
    WHEN c.column_name IS NULL THEN 'blocked_missing_tool_registry_column'
    ELSE 'ready'
  END AS tool_registry_column_status
FROM required_tool_columns e
LEFT JOIN information_schema.tables t
  ON t.table_schema = DATABASE()
 AND t.table_name = 'admin_platform_endpoint_tools'
LEFT JOIN information_schema.columns c
  ON c.table_schema = DATABASE()
 AND c.table_name = 'admin_platform_endpoint_tools'
 AND c.column_name = e.column_name
ORDER BY e.column_name;

SELECT
  tool_key,
  is_enabled,
  'blocked_existing_tool_key_requires_reconciliation' AS preflight_status
FROM admin_platform_endpoint_tools
WHERE tool_key IN (
  'hostinger_storage_snapshot_read',
  'hostinger_storage_plan_inspect',
  'hostinger_storage_plan_apply'
)
ORDER BY tool_key;

SELECT
  VERSION() AS database_version,
  @@sql_mode AS sql_mode,
  @@character_set_database AS database_character_set,
  @@collation_database AS database_collation,
  CASE
    WHEN @@character_set_database = 'utf8mb4'
     AND @@collation_database = 'utf8mb4_unicode_ci'
    THEN 'ready'
    ELSE 'blocked_database_charset_or_collation'
  END AS database_contract_status,
  'not_signed' AS schema_verification_status,
  0 AS provider_calls,
  0 AS credential_payload_reads,
  0 AS external_sends,
  0 AS external_writes,
  0 AS secrets_included;
