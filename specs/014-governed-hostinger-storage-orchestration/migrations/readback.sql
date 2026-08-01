-- spec014_hostinger_storage_readback.sql
-- DRAFT SAME-CYCLE READBACK; specification-local and not runnable by governed-migration-runner.
-- Task: T027
-- migration_apply_authorized=false
-- no_provider_call
-- no_credential_payload_read
-- no_raw_secrets
-- no_external_send
-- no_external_write
-- secrets_included=false

WITH expected_tables AS (
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
),
expected_views AS (
  SELECT 'v_storage_admin_target_readiness' AS object_name UNION ALL
  SELECT 'v_storage_tenant_target_readiness' UNION ALL
  SELECT 'v_storage_cleanup_operation_readback'
)
SELECT
  (SELECT COUNT(*) FROM expected_tables) AS expected_table_count,
  (SELECT COUNT(*) FROM information_schema.tables t
    JOIN expected_tables e ON e.object_name = t.table_name
    WHERE t.table_schema = DATABASE() AND t.table_type = 'BASE TABLE') AS present_table_count,
  (SELECT COUNT(*) FROM expected_views) AS expected_view_count,
  (SELECT COUNT(*) FROM information_schema.views v
    JOIN expected_views e ON e.object_name = v.table_name
    WHERE v.table_schema = DATABASE()) AS present_view_count,
  CASE
    WHEN (SELECT COUNT(*) FROM information_schema.tables t
      JOIN expected_tables e ON e.object_name = t.table_name
      WHERE t.table_schema = DATABASE() AND t.table_type = 'BASE TABLE') = 15
     AND (SELECT COUNT(*) FROM information_schema.views v
      JOIN expected_views e ON e.object_name = v.table_name
      WHERE v.table_schema = DATABASE()) = 3
    THEN 'ready'
    ELSE 'blocked'
  END AS object_readiness_status,
  0 AS secrets_included;

SELECT
  table_name,
  COUNT(DISTINCT index_name) AS index_count,
  SUM(index_name = 'PRIMARY') AS primary_index_count
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name LIKE 'storage\\_%'
GROUP BY table_name
ORDER BY table_name;

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
  'spec014_hostinger_storage_migration_readback_v1' AS contract_key,
  0 AS provider_calls,
  0 AS credential_payload_reads,
  0 AS external_sends,
  0 AS external_writes,
  0 AS secrets_included;
