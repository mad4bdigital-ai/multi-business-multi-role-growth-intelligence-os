-- Sprint 65: validator result log foundation.
--
-- Records validator execution evidence for platform engine plans. This table is
-- evidence only: it does not execute validators, mutate repos, publish content,
-- perform external writes, or read secrets.

CREATE TABLE IF NOT EXISTS platform_engine_validator_result_log (
  result_id VARCHAR(36) NOT NULL PRIMARY KEY,
  run_id VARCHAR(36) NULL,
  run_key VARCHAR(191) NULL,
  engine_key VARCHAR(191) NOT NULL,
  task_class VARCHAR(191) NOT NULL,
  resource_key VARCHAR(500) NULL,
  resource_kind VARCHAR(191) NULL,
  validator_key VARCHAR(191) NULL,
  validator_command VARCHAR(1000) NOT NULL,
  status ENUM('passed','failed','skipped','blocked') NOT NULL DEFAULT 'blocked',
  exit_code INT NULL,
  duration_ms INT NULL,
  output_excerpt TEXT NULL,
  error_excerpt TEXT NULL,
  evidence_json JSON NULL,
  artifact_refs_json JSON NULL,
  policy_key VARCHAR(191) NULL,
  strategy_key VARCHAR(191) NULL,
  trace_id VARCHAR(191) NULL,
  actor_id VARCHAR(191) NULL,
  tenant_id VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_platform_engine_validator_run (run_id, created_at),
  KEY idx_platform_engine_validator_engine (engine_key, task_class, status, created_at),
  KEY idx_platform_engine_validator_resource (resource_kind, resource_key(191), status),
  KEY idx_platform_engine_validator_trace (trace_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW v_platform_engine_validator_result_summary AS
SELECT
  engine_key,
  task_class,
  status,
  COUNT(*) AS result_count,
  MAX(created_at) AS last_result_at
FROM platform_engine_validator_result_log
GROUP BY engine_key, task_class, status;

CREATE OR REPLACE VIEW v_platform_engine_validator_latest_failures AS
SELECT
  result_id,
  run_id,
  run_key,
  engine_key,
  task_class,
  resource_key,
  resource_kind,
  validator_command,
  status,
  exit_code,
  LEFT(COALESCE(error_excerpt, output_excerpt, ''), 1000) AS failure_excerpt,
  trace_id,
  actor_id,
  created_at
FROM platform_engine_validator_result_log
WHERE status IN ('failed','blocked')
ORDER BY created_at DESC;

INSERT INTO admin_platform_endpoint_tools
(tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order)
VALUES
('platform_engine_validator_results','Platform Engine Validator Results','List platform engine validator execution evidence. Read-only; does not execute validators or apply changes.','GET','/platform/engines/validator-results',NULL,JSON_OBJECT('type','object','properties',JSON_OBJECT('engine_key',JSON_OBJECT('type','string'),'task_class',JSON_OBJECT('type','string'),'run_id',JSON_OBJECT('type','string'),'status',JSON_OBJECT('type','string'),'limit',JSON_OBJECT('type','integer'))),NULL,'platform_engine,validators,evidence,read_only,no_execution,no_apply,admin',1,4290),
('platform_engine_validator_result_log','Platform Engine Validator Result Log','Record validator result evidence for a platform engine plan. Evidence-only; does not execute validators, apply changes, or read secrets.','POST','/platform/engines/validator-results',NULL,JSON_OBJECT('type','object','required',JSON_ARRAY('engine_key','task_class','validator_command','status'),'properties',JSON_OBJECT('run_id',JSON_OBJECT('type','string'),'run_key',JSON_OBJECT('type','string'),'engine_key',JSON_OBJECT('type','string'),'task_class',JSON_OBJECT('type','string'),'resource_key',JSON_OBJECT('type','string'),'resource_kind',JSON_OBJECT('type','string'),'validator_key',JSON_OBJECT('type','string'),'validator_command',JSON_OBJECT('type','string'),'status',JSON_OBJECT('type','string','enum',JSON_ARRAY('passed','failed','skipped','blocked')),'exit_code',JSON_OBJECT('type','integer'),'duration_ms',JSON_OBJECT('type','integer'),'output_excerpt',JSON_OBJECT('type','string'),'error_excerpt',JSON_OBJECT('type','string'),'evidence',JSON_OBJECT('type','object'),'artifact_refs',JSON_OBJECT('type','array'),'policy_key',JSON_OBJECT('type','string'),'strategy_key',JSON_OBJECT('type','string'),'trace_id',JSON_OBJECT('type','string'),'actor_id',JSON_OBJECT('type','string'),'tenant_id',JSON_OBJECT('type','string'))),NULL,'platform_engine,validators,evidence_write,no_execution,no_apply,no_secret_read,admin',1,4291)
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
  CASE WHEN tool_key = 'platform_engine_validator_results' THEN 'read_only' ELSE 'admin_registry_write' END AS risk_class,
  'platform_engine_default_v1' AS policy_key,
  JSON_ARRAY('platform_engine', 'validator_evidence', REPLACE(COALESCE(tags, ''), ',', ' ')) AS deferred_search_tags_json,
  'active' AS status,
  CURRENT_TIMESTAMP AS last_indexed_at
FROM admin_platform_endpoint_tools
WHERE tool_key IN ('platform_engine_validator_results', 'platform_engine_validator_result_log')
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
