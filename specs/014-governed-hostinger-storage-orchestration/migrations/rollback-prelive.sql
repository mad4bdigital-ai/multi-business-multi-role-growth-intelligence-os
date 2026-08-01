-- spec014_hostinger_storage_rollback_pre_live.sql
-- DRAFT ROLLBACK PLAN ONLY; no destructive statement is executed by this file.
-- Task: T027
-- rollback_requires_separate_authority=true
-- rollback_pre_live_only=true
-- migration_apply_authorized=false
-- no_provider_call
-- no_credential_payload_read
-- no_raw_secrets
-- no_external_send
-- no_external_write
-- secrets_included=false

WITH storage_row_counts AS (
  SELECT 'storage_cleanup_run_items' AS table_name, COUNT(*) AS row_count FROM storage_cleanup_run_items UNION ALL
  SELECT 'storage_reconciliation_results', COUNT(*) FROM storage_reconciliation_results UNION ALL
  SELECT 'storage_cleanup_runs', COUNT(*) FROM storage_cleanup_runs UNION ALL
  SELECT 'storage_cleanup_approvals', COUNT(*) FROM storage_cleanup_approvals UNION ALL
  SELECT 'storage_execution_leases', COUNT(*) FROM storage_execution_leases UNION ALL
  SELECT 'storage_cleanup_plan_impacts', COUNT(*) FROM storage_cleanup_plan_impacts UNION ALL
  SELECT 'storage_cleanup_plan_items', COUNT(*) FROM storage_cleanup_plan_items UNION ALL
  SELECT 'storage_cleanup_plans', COUNT(*) FROM storage_cleanup_plans UNION ALL
  SELECT 'storage_cleanup_operations', COUNT(*) FROM storage_cleanup_operations UNION ALL
  SELECT 'storage_emergency_reserves', COUNT(*) FROM storage_emergency_reserves UNION ALL
  SELECT 'storage_pressure_incidents', COUNT(*) FROM storage_pressure_incidents UNION ALL
  SELECT 'storage_pressure_snapshots', COUNT(*) FROM storage_pressure_snapshots UNION ALL
  SELECT 'storage_target_bindings', COUNT(*) FROM storage_target_bindings UNION ALL
  SELECT 'storage_targets', COUNT(*) FROM storage_targets UNION ALL
  SELECT 'storage_provider_accounts', COUNT(*) FROM storage_provider_accounts
)
SELECT
  table_name,
  row_count,
  CASE WHEN row_count = 0 THEN 'eligible_for_separately_governed_pre_live_drop'
       ELSE 'blocked_preserve_durable_evidence' END AS rollback_status
FROM storage_row_counts
ORDER BY table_name;

-- The statements below are returned as data, not executed. A separate authorized rollback
-- migration may use them only when every row_count above is zero and all runtime/tool flags
-- are disabled with same-cycle readback.
SELECT 1 AS rollback_order, 'DROP VIEW IF EXISTS v_storage_cleanup_operation_readback' AS separately_governed_statement UNION ALL
SELECT 2, 'DROP VIEW IF EXISTS v_storage_tenant_target_readiness' UNION ALL
SELECT 3, 'DROP VIEW IF EXISTS v_storage_admin_target_readiness' UNION ALL
SELECT 4, 'DROP TABLE IF EXISTS storage_cleanup_run_items' UNION ALL
SELECT 5, 'DROP TABLE IF EXISTS storage_reconciliation_results' UNION ALL
SELECT 6, 'DROP TABLE IF EXISTS storage_cleanup_runs' UNION ALL
SELECT 7, 'DROP TABLE IF EXISTS storage_cleanup_approvals' UNION ALL
SELECT 8, 'DROP TABLE IF EXISTS storage_execution_leases' UNION ALL
SELECT 9, 'DROP TABLE IF EXISTS storage_cleanup_plan_impacts' UNION ALL
SELECT 10, 'DROP TABLE IF EXISTS storage_cleanup_plan_items' UNION ALL
SELECT 11, 'DROP TABLE IF EXISTS storage_cleanup_plans' UNION ALL
SELECT 12, 'DROP TABLE IF EXISTS storage_cleanup_operations' UNION ALL
SELECT 13, 'DROP TABLE IF EXISTS storage_emergency_reserves' UNION ALL
SELECT 14, 'DROP TABLE IF EXISTS storage_pressure_incidents' UNION ALL
SELECT 15, 'DROP TABLE IF EXISTS storage_pressure_snapshots' UNION ALL
SELECT 16, 'DROP TABLE IF EXISTS storage_target_bindings' UNION ALL
SELECT 17, 'DROP TABLE IF EXISTS storage_targets' UNION ALL
SELECT 18, 'DROP TABLE IF EXISTS storage_provider_accounts'
ORDER BY rollback_order;

SELECT
  'spec014_hostinger_storage_rollback_pre_live_v1' AS contract_key,
  'not_executed' AS execution_status,
  0 AS provider_calls,
  0 AS credential_payload_reads,
  0 AS external_sends,
  0 AS external_writes,
  0 AS secrets_included;
