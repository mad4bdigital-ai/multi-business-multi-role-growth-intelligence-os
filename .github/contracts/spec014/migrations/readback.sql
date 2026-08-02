-- spec014_hostinger_storage_readback.sql
-- DRAFT SAME-CYCLE READBACK; contract-local and not runnable by governed-migration-runner.
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
  SELECT object_name FROM JSON_TABLE(
    '["storage_provider_accounts","storage_targets","storage_target_bindings","storage_pressure_snapshots","storage_cleanup_operations","storage_cleanup_plans","storage_cleanup_plan_items","storage_cleanup_plan_impacts","storage_cleanup_approvals","storage_execution_leases","storage_cleanup_runs","storage_cleanup_run_items","storage_reconciliation_results","storage_emergency_reserves","storage_pressure_incidents","storage_authorized_injection_states","storage_authorized_injection_rollbacks"]',
    '$[*]' COLUMNS(object_name VARCHAR(128) PATH '$')
  ) AS j
), expected_views AS (
  SELECT object_name FROM JSON_TABLE(
    '["v_storage_admin_target_readiness","v_storage_tenant_target_readiness","v_storage_cleanup_operation_readback"]',
    '$[*]' COLUMNS(object_name VARCHAR(128) PATH '$')
  ) AS j
)
SELECT
  17 AS expected_table_count,
  SUM(t.table_name IS NOT NULL AND t.table_type = 'BASE TABLE' AND t.engine = 'InnoDB' AND t.table_collation = 'utf8mb4_unicode_ci') AS compatible_table_count,
  3 AS expected_view_count,
  (SELECT COUNT(*) FROM information_schema.views v JOIN expected_views e ON e.object_name = v.table_name WHERE v.table_schema = DATABASE()) AS present_view_count,
  CASE
    WHEN SUM(t.table_name IS NOT NULL AND t.table_type = 'BASE TABLE' AND t.engine = 'InnoDB' AND t.table_collation = 'utf8mb4_unicode_ci') = 17
     AND (SELECT COUNT(*) FROM information_schema.views v JOIN expected_views e ON e.object_name = v.table_name WHERE v.table_schema = DATABASE()) = 3
    THEN 'ready_for_column_index_constraint_readback'
    ELSE 'blocked'
  END AS object_readiness_status,
  0 AS secrets_included
FROM expected_tables e
LEFT JOIN information_schema.tables t
  ON t.table_schema = DATABASE() AND t.table_name = e.object_name;

WITH expected_runtime_columns AS (
  SELECT table_name, column_name, data_type FROM JSON_TABLE(
    '[
      {"t":"storage_cleanup_operations","c":"id","d":"char"},{"t":"storage_cleanup_operations","c":"idempotency_key","d":"char"},{"t":"storage_cleanup_operations","c":"target_id","d":"char"},{"t":"storage_cleanup_operations","c":"state","d":"varchar"},{"t":"storage_cleanup_operations","c":"version","d":"bigint"},{"t":"storage_cleanup_operations","c":"record_digest","d":"char"},{"t":"storage_cleanup_operations","c":"record_json","d":"json"},{"t":"storage_cleanup_operations","c":"row_version","d":"bigint"},
      {"t":"storage_cleanup_plans","c":"id","d":"char"},{"t":"storage_cleanup_plans","c":"operation_id","d":"char"},{"t":"storage_cleanup_plans","c":"target_id","d":"char"},{"t":"storage_cleanup_plans","c":"plan_hash","d":"char"},{"t":"storage_cleanup_plans","c":"consumed","d":"tinyint"},{"t":"storage_cleanup_plans","c":"record_digest","d":"char"},{"t":"storage_cleanup_plans","c":"record_json","d":"json"},{"t":"storage_cleanup_plans","c":"row_version","d":"bigint"},
      {"t":"storage_cleanup_approvals","c":"id","d":"char"},{"t":"storage_cleanup_approvals","c":"plan_id","d":"char"},{"t":"storage_cleanup_approvals","c":"approval_slot","d":"varchar"},{"t":"storage_cleanup_approvals","c":"decision","d":"varchar"},{"t":"storage_cleanup_approvals","c":"invalidated","d":"tinyint"},{"t":"storage_cleanup_approvals","c":"record_digest","d":"char"},{"t":"storage_cleanup_approvals","c":"record_json","d":"json"},{"t":"storage_cleanup_approvals","c":"row_version","d":"bigint"},
      {"t":"storage_execution_leases","c":"target_id","d":"char"},{"t":"storage_execution_leases","c":"lease_id","d":"char"},{"t":"storage_execution_leases","c":"operation_id","d":"char"},{"t":"storage_execution_leases","c":"generation","d":"bigint"},{"t":"storage_execution_leases","c":"status","d":"varchar"},{"t":"storage_execution_leases","c":"expires_at_epoch","d":"bigint"},{"t":"storage_execution_leases","c":"record_digest","d":"char"},{"t":"storage_execution_leases","c":"record_json","d":"json"},{"t":"storage_execution_leases","c":"row_version","d":"bigint"},
      {"t":"storage_cleanup_run_items","c":"id","d":"char"},{"t":"storage_cleanup_run_items","c":"operation_id","d":"char"},{"t":"storage_cleanup_run_items","c":"run_id","d":"char"},{"t":"storage_cleanup_run_items","c":"plan_id","d":"char"},{"t":"storage_cleanup_run_items","c":"item_id","d":"varchar"},{"t":"storage_cleanup_run_items","c":"sequence","d":"bigint"},{"t":"storage_cleanup_run_items","c":"phase","d":"varchar"},{"t":"storage_cleanup_run_items","c":"result","d":"varchar"},{"t":"storage_cleanup_run_items","c":"record_digest","d":"char"},{"t":"storage_cleanup_run_items","c":"record_json","d":"json"},{"t":"storage_cleanup_run_items","c":"row_version","d":"bigint"},
      {"t":"storage_reconciliation_results","c":"id","d":"char"},{"t":"storage_reconciliation_results","c":"operation_id","d":"char"},{"t":"storage_reconciliation_results","c":"run_id","d":"char"},{"t":"storage_reconciliation_results","c":"outcome","d":"varchar"},{"t":"storage_reconciliation_results","c":"retry_permission","d":"tinyint"},{"t":"storage_reconciliation_results","c":"record_digest","d":"char"},{"t":"storage_reconciliation_results","c":"record_json","d":"json"},{"t":"storage_reconciliation_results","c":"row_version","d":"bigint"},
      {"t":"storage_authorized_injection_states","c":"injection_id","d":"varchar"},{"t":"storage_authorized_injection_states","c":"injection_receipt_digest","d":"char"},{"t":"storage_authorized_injection_states","c":"mount_readback_digest","d":"char"},{"t":"storage_authorized_injection_states","c":"mount_bundle_digest","d":"char"},{"t":"storage_authorized_injection_states","c":"active","d":"tinyint"},{"t":"storage_authorized_injection_states","c":"generation","d":"bigint"},{"t":"storage_authorized_injection_states","c":"record_digest","d":"char"},{"t":"storage_authorized_injection_states","c":"record_json","d":"json"},{"t":"storage_authorized_injection_states","c":"row_version","d":"bigint"},{"t":"storage_authorized_injection_states","c":"secrets_included","d":"tinyint"},
      {"t":"storage_authorized_injection_rollbacks","c":"id","d":"char"},{"t":"storage_authorized_injection_rollbacks","c":"injection_id","d":"varchar"},{"t":"storage_authorized_injection_rollbacks","c":"rollback_receipt_digest","d":"char"},{"t":"storage_authorized_injection_rollbacks","c":"record_digest","d":"char"},{"t":"storage_authorized_injection_rollbacks","c":"record_json","d":"json"},{"t":"storage_authorized_injection_rollbacks","c":"secrets_included","d":"tinyint"}
    ]',
    '$[*]' COLUMNS(table_name VARCHAR(128) PATH '$.t', column_name VARCHAR(128) PATH '$.c', data_type VARCHAR(32) PATH '$.d')
  ) AS j
)
SELECT
  COUNT(*) AS expected_runtime_column_count,
  SUM(c.column_name IS NOT NULL AND c.data_type = e.data_type) AS compatible_runtime_column_count,
  SUM(c.column_name IS NULL) AS missing_runtime_column_count,
  SUM(c.column_name IS NOT NULL AND c.data_type <> e.data_type) AS incompatible_runtime_column_count,
  CASE WHEN SUM(c.column_name IS NOT NULL AND c.data_type = e.data_type) = COUNT(*) THEN 'ready' ELSE 'blocked' END AS runtime_column_readback_status,
  0 AS secrets_included
FROM expected_runtime_columns e
LEFT JOIN information_schema.columns c
  ON c.table_schema = DATABASE() AND c.table_name = e.table_name AND c.column_name = e.column_name;

WITH expected_runtime_indexes AS (
  SELECT table_name, index_name, column_name, seq_in_index FROM JSON_TABLE(
    '[
      {"t":"storage_cleanup_operations","i":"PRIMARY","c":"id","s":1},{"t":"storage_cleanup_operations","i":"uq_storage_cleanup_operations_idempotency","c":"operation_class","s":1},{"t":"storage_cleanup_operations","i":"uq_storage_cleanup_operations_idempotency","c":"target_id","s":2},{"t":"storage_cleanup_operations","i":"uq_storage_cleanup_operations_idempotency","c":"idempotency_key","s":3},
      {"t":"storage_cleanup_plans","i":"PRIMARY","c":"id","s":1},{"t":"storage_cleanup_plans","i":"uq_storage_cleanup_plans_operation_hash","c":"operation_id","s":1},{"t":"storage_cleanup_plans","i":"uq_storage_cleanup_plans_operation_hash","c":"plan_hash","s":2},
      {"t":"storage_cleanup_approvals","i":"PRIMARY","c":"id","s":1},{"t":"storage_cleanup_approvals","i":"uq_storage_cleanup_approvals_generation","c":"plan_id","s":1},{"t":"storage_cleanup_approvals","i":"uq_storage_cleanup_approvals_generation","c":"approval_slot","s":2},{"t":"storage_cleanup_approvals","i":"uq_storage_cleanup_approvals_generation","c":"approval_generation","s":3},
      {"t":"storage_execution_leases","i":"PRIMARY","c":"target_id","s":1},{"t":"storage_execution_leases","i":"uq_storage_execution_leases_active","c":"target_id","s":1},{"t":"storage_execution_leases","i":"uq_storage_execution_leases_active","c":"root_ref_digest","s":2},{"t":"storage_execution_leases","i":"uq_storage_execution_leases_active","c":"active_slot","s":3},
      {"t":"storage_cleanup_run_items","i":"PRIMARY","c":"id","s":1},{"t":"storage_cleanup_run_items","i":"uq_storage_cleanup_run_items_sequence","c":"run_id","s":1},{"t":"storage_cleanup_run_items","i":"uq_storage_cleanup_run_items_sequence","c":"plan_item_id","s":2},{"t":"storage_cleanup_run_items","i":"uq_storage_cleanup_run_items_sequence","c":"sequence","s":3},
      {"t":"storage_reconciliation_results","i":"PRIMARY","c":"id","s":1},{"t":"storage_reconciliation_results","i":"uq_storage_reconciliation_generation","c":"run_id","s":1},{"t":"storage_reconciliation_results","i":"uq_storage_reconciliation_generation","c":"reconciliation_generation","s":2},
      {"t":"storage_authorized_injection_states","i":"PRIMARY","c":"injection_id","s":1},{"t":"storage_authorized_injection_states","i":"uq_storage_authorized_injection_receipt","c":"injection_receipt_digest","s":1},{"t":"storage_authorized_injection_states","i":"uq_storage_authorized_injection_readback","c":"mount_readback_digest","s":1},{"t":"storage_authorized_injection_states","i":"idx_storage_authorized_injection_bundle","c":"mount_bundle_digest","s":1},{"t":"storage_authorized_injection_states","i":"idx_storage_authorized_injection_active_generation","c":"active","s":1},{"t":"storage_authorized_injection_states","i":"idx_storage_authorized_injection_active_generation","c":"generation","s":2},
      {"t":"storage_authorized_injection_rollbacks","i":"PRIMARY","c":"id","s":1},{"t":"storage_authorized_injection_rollbacks","i":"uq_storage_authorized_injection_rollback_once","c":"injection_id","s":1},{"t":"storage_authorized_injection_rollbacks","i":"uq_storage_authorized_injection_rollback_digest","c":"rollback_receipt_digest","s":1}
    ]',
    '$[*]' COLUMNS(table_name VARCHAR(128) PATH '$.t', index_name VARCHAR(128) PATH '$.i', column_name VARCHAR(128) PATH '$.c', seq_in_index INT PATH '$.s')
  ) AS j
)
SELECT
  COUNT(*) AS expected_runtime_index_column_count,
  SUM(s.index_name IS NOT NULL AND s.column_name = e.column_name AND s.seq_in_index = e.seq_in_index) AS compatible_runtime_index_column_count,
  CASE WHEN SUM(s.index_name IS NOT NULL AND s.column_name = e.column_name AND s.seq_in_index = e.seq_in_index) = COUNT(*) THEN 'ready' ELSE 'blocked' END AS runtime_index_readback_status,
  0 AS secrets_included
FROM expected_runtime_indexes e
LEFT JOIN information_schema.statistics s
  ON s.table_schema = DATABASE() AND s.table_name = e.table_name AND s.index_name = e.index_name AND s.seq_in_index = e.seq_in_index;

SELECT table_name, constraint_type, COUNT(*) AS constraint_count
FROM information_schema.table_constraints
WHERE table_schema = DATABASE() AND table_name LIKE 'storage\\_%'
GROUP BY table_name, constraint_type
ORDER BY table_name, constraint_type;

SELECT
  3 AS expected_default_off_tool_count,
  COUNT(*) AS observed_tool_count,
  SUM(is_enabled = 0) AS disabled_tool_count,
  SUM(is_enabled <> 0) AS enabled_tool_count,
  CASE WHEN COUNT(*) = 3 AND SUM(is_enabled = 0) = 3 THEN 'ready_default_off' ELSE 'blocked' END AS tool_seed_readback_status,
  0 AS secrets_included
FROM admin_platform_endpoint_tools
WHERE tool_key IN ('hostinger_storage_snapshot_read','hostinger_storage_plan_inspect','hostinger_storage_plan_apply');

SELECT
  tool_key,
  is_enabled,
  CASE WHEN is_enabled = 0 THEN 'ready_default_off' ELSE 'blocked_tool_enabled' END AS seed_status
FROM admin_platform_endpoint_tools
WHERE tool_key IN ('hostinger_storage_snapshot_read','hostinger_storage_plan_inspect','hostinger_storage_plan_apply')
ORDER BY tool_key;

SELECT
  'spec014_hostinger_storage_migration_readback_v4' AS contract_key,
  'candidate_only_unsigned' AS schema_verification_status,
  0 AS production_ready,
  0 AS provider_calls,
  0 AS credential_payload_reads,
  0 AS external_sends,
  0 AS external_writes,
  0 AS secrets_included;
