-- Sprint 65: lifecycle report snapshots foundation.
--
-- Stores bounded, read-only snapshots of lifecycle reporting views. This is
-- evidence/history only: no drop, truncate, delete, archive execution, external
-- write, repo mutation, or secret readback.

CREATE TABLE IF NOT EXISTS platform_lifecycle_report_snapshots (
  snapshot_id VARCHAR(36) NOT NULL PRIMARY KEY,
  report_key VARCHAR(191) NOT NULL,
  report_scope VARCHAR(191) NOT NULL DEFAULT 'database_lifecycle',
  status ENUM('created','superseded','invalid') NOT NULL DEFAULT 'created',
  summary_json JSON NOT NULL,
  snapshot_json JSON NOT NULL,
  source_views_json JSON NULL,
  trace_id VARCHAR(191) NULL,
  actor_id VARCHAR(191) NULL,
  tenant_id VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_lifecycle_report_snapshot_report (report_key, status, created_at),
  KEY idx_lifecycle_report_snapshot_scope (report_scope, created_at),
  KEY idx_lifecycle_report_snapshot_trace (trace_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW v_platform_lifecycle_report_snapshot_latest AS
SELECT s.*
FROM platform_lifecycle_report_snapshots s
JOIN (
  SELECT report_key, MAX(created_at) AS latest_created_at
  FROM platform_lifecycle_report_snapshots
  WHERE status = 'created'
  GROUP BY report_key
) latest
  ON latest.report_key = s.report_key
 AND latest.latest_created_at = s.created_at
WHERE s.status = 'created';

INSERT INTO admin_platform_endpoint_tools
(tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order)
VALUES
('database_lifecycle_report_snapshots','Database Lifecycle Report Snapshots','List stored lifecycle report snapshots. Read-only; does not run cleanup, archive, or deletion.','GET','/platform/engines/database-table-lifecycle/report-snapshots',NULL,JSON_OBJECT('type','object','properties',JSON_OBJECT('report_key',JSON_OBJECT('type','string'),'limit',JSON_OBJECT('type','integer'))),NULL,'platform_engine,database_lifecycle,report_snapshots,read_only,no_drop,no_archive,no_delete,admin',1,4255),
('database_lifecycle_report_snapshot_create','Create Database Lifecycle Report Snapshot','Create a bounded database lifecycle report snapshot from read-only lifecycle reporting views. Evidence only; no cleanup, archive, or deletion.','POST','/platform/engines/database-table-lifecycle/report-snapshots',NULL,JSON_OBJECT('type','object','properties',JSON_OBJECT('report_key',JSON_OBJECT('type','string'),'trace_id',JSON_OBJECT('type','string'),'actor_id',JSON_OBJECT('type','string'),'tenant_id',JSON_OBJECT('type','string'))),NULL,'platform_engine,database_lifecycle,report_snapshots,evidence_write,no_drop,no_archive,no_delete,admin',1,4256)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  http_method = VALUES(http_method),
  http_path = VALUES(http_path),
  path_param_keys = VALUES(path_param_keys),
  input_schema = VALUES(input_schema),
  fixed_body = VALUES(fixed_body),
  tags = VALUES(tags),
  is_enabled = VALUES(is_enabled),
  sort_order = VALUES(sort_order);

INSERT INTO agent_tool_index
(tool_key, source_truth_resource_type, source_truth_resource_key, display_name,
 tool_manifest_json, risk_class, policy_key, deferred_search_tags_json, status,
 last_indexed_at)
SELECT
  tool_key,
  'endpoint' AS source_truth_resource_type,
  tool_key AS source_truth_resource_key,
  display_name,
  JSON_OBJECT(
    'tool_key', tool_key,
    'display_name', display_name,
    'description', LEFT(COALESCE(description, ''), 500),
    'http_method', http_method,
    'http_path', http_path,
    'source', 'admin_platform_endpoint_tools',
    'raw_catalog_exposed', false
  ) AS tool_manifest_json,
  CASE WHEN tool_key = 'database_lifecycle_report_snapshots' THEN 'read_only' ELSE 'admin_registry_write' END AS risk_class,
  'database_lifecycle_policy_v1' AS policy_key,
  JSON_ARRAY('database_lifecycle', 'report_snapshots', REPLACE(COALESCE(tags, ''), ',', ' ')) AS deferred_search_tags_json,
  'active' AS status,
  CURRENT_TIMESTAMP AS last_indexed_at
FROM admin_platform_endpoint_tools
WHERE tool_key IN ('database_lifecycle_report_snapshots', 'database_lifecycle_report_snapshot_create')
ON DUPLICATE KEY UPDATE
  source_truth_resource_type = VALUES(source_truth_resource_type),
  source_truth_resource_key = VALUES(source_truth_resource_key),
  display_name = VALUES(display_name),
  tool_manifest_json = VALUES(tool_manifest_json),
  risk_class = VALUES(risk_class),
  policy_key = VALUES(policy_key),
  deferred_search_tags_json = VALUES(deferred_search_tags_json),
  status = VALUES(status),
  last_indexed_at = VALUES(last_indexed_at);
