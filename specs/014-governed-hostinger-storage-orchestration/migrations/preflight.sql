-- spec014_hostinger_storage_preflight.sql
-- DRAFT READ-ONLY PREFLIGHT; specification-local and not runnable by governed-migration-runner.
-- Task: T027
-- migration_apply_authorized=false
-- no_provider_call
-- no_credential_payload_read
-- no_raw_secrets
-- no_external_send
-- no_external_write
-- secrets_included=false

WITH expected_objects AS (
  SELECT 'storage_provider_accounts' AS object_name UNION ALL
  SELECT 'storage_targets' UNION ALL
  SELECT 'storage_target_bindings' UNION ALL
  SELECT 'storage_pressure_snapshots' UNION ALL
  SELECT 'storage_cleanup_operations' UNION ALL
  SELECT 'storage_cleanup_plans' UNION ALL
  SELECT 'storage_cleanup_plan_items' UNION ALL
  SELECT 'storage_cleanup_plan_impacts' UNION ALL
  SELECT 'storage_cleanup_approvals' UNION ALL
  SELECT 'storage_execution_leases' UNION ALL
  SELECT 'storage_cleanup_runs' UNION ALL
  SELECT 'storage_cleanup_run_items' UNION ALL
  SELECT 'storage_reconciliation_results' UNION ALL
  SELECT 'storage_emergency_reserves' UNION ALL
  SELECT 'storage_pressure_incidents'
)
SELECT
  e.object_name,
  CASE
    WHEN t.table_name IS NULL THEN 'absent_ready_for_additive_create'
    WHEN t.table_type = 'BASE TABLE' AND t.engine = 'InnoDB'
      AND t.table_collation = 'utf8mb4_unicode_ci'
      THEN 'existing_requires_exact_column_constraint_readback'
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
  SELECT 'tenants' AS table_name, 'id' AS column_name UNION ALL
  SELECT 'workspaces', 'id' UNION ALL
  SELECT 'platform_resources', 'id'
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
    ELSE 'ready_for_exact_external_fk_generation'
  END AS parent_readback_status
FROM required_parents p
LEFT JOIN information_schema.columns c
  ON c.table_schema = DATABASE()
 AND c.table_name = p.table_name
 AND c.column_name = p.column_name
ORDER BY p.table_name;

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
  0 AS provider_calls,
  0 AS credential_payload_reads,
  0 AS external_sends,
  0 AS external_writes,
  0 AS secrets_included;
