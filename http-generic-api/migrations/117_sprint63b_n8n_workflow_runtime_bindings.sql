-- Sprint 63b: governed n8n workflow runtime bindings
--
-- This table maps platform workflow keys to n8n webhook executions.
-- Secrets are not stored here; auth uses environment variable names only.

CREATE TABLE IF NOT EXISTS `workflow_runtime_bindings` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `binding_key` VARCHAR(160) NOT NULL,
  `workflow_key` VARCHAR(190) NOT NULL,
  `runtime_type` ENUM('js','n8n','external_http') NOT NULL DEFAULT 'n8n',
  `task_class` VARCHAR(80) NULL,
  `tenant_id` VARCHAR(100) NULL,
  `n8n_workflow_id` VARCHAR(190) NULL,
  `n8n_webhook_path` VARCHAR(700) NULL,
  `n8n_webhook_url` VARCHAR(1200) NULL,
  `execution_mode` ENUM('sync','async') NOT NULL DEFAULT 'sync',
  `auth_mode` ENUM('none','bearer_env','header_env') NOT NULL DEFAULT 'none',
  `credential_env_var` VARCHAR(160) NULL,
  `auth_header_name` VARCHAR(160) NOT NULL DEFAULT 'Authorization',
  `input_schema_json` JSON NULL,
  `output_schema_json` JSON NULL,
  `timeout_ms` INT NOT NULL DEFAULT 30000,
  `status` ENUM('active','disabled','archived') NOT NULL DEFAULT 'active',
  `metadata_json` JSON NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_workflow_runtime_binding_key` (`binding_key`),
  KEY `idx_workflow_runtime_workflow` (`workflow_key`, `status`),
  KEY `idx_workflow_runtime_task` (`task_class`, `status`),
  KEY `idx_workflow_runtime_tenant` (`tenant_id`, `workflow_key`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `admin_platform_endpoint_tools` (
  `tool_key`, `display_name`, `description`, `http_method`, `http_path`, `path_param_keys`,
  `input_schema`, `fixed_body`, `tags`, `is_enabled`, `sort_order`
) VALUES
(
  'workflow_runtime_bindings_list',
  'Workflow Runtime Bindings List',
  'List governed workflow runtime bindings. Returns sanitized n8n binding metadata only; no secrets.',
  'GET',
  '/workflow-runtime/bindings',
  NULL,
  '{"type":"object","properties":{"status":{"type":"string"},"workflow_key":{"type":"string"},"task_class":{"type":"string"},"runtime_type":{"type":"string"},"limit":{"type":"integer","minimum":1,"maximum":200}}}',
  NULL,
  'workflow_runtime,n8n,settings,read_only',
  1,
  130
),
(
  'workflow_runtime_binding_upsert',
  'Workflow Runtime Binding Upsert',
  'Create or update a governed n8n workflow runtime binding. Secret values are not accepted; use credential_env_var names only.',
  'POST',
  '/workflow-runtime/bindings',
  NULL,
  '{"type":"object","required":["binding_key","workflow_key"],"properties":{"binding_key":{"type":"string"},"workflow_key":{"type":"string"},"runtime_type":{"type":"string"},"task_class":{"type":"string"},"tenant_id":{"type":"string"},"n8n_workflow_id":{"type":"string"},"n8n_webhook_path":{"type":"string"},"n8n_webhook_url":{"type":"string"},"execution_mode":{"type":"string"},"auth_mode":{"type":"string"},"credential_env_var":{"type":"string"},"auth_header_name":{"type":"string"},"input_schema_json":{"type":"object"},"output_schema_json":{"type":"object"},"timeout_ms":{"type":"integer"},"status":{"type":"string"},"metadata_json":{"type":"object"}}}',
  NULL,
  'workflow_runtime,n8n,settings,state_changing,audited',
  1,
  131
),
(
  'workflow_runtime_run',
  'Workflow Runtime Run',
  'Run a governed n8n workflow binding through the platform runtime. Validates input schema, records workflow_runs, and returns structured errors.',
  'POST',
  '/workflow-runtime/run',
  NULL,
  '{"type":"object","properties":{"binding_key":{"type":"string"},"workflow_key":{"type":"string"},"tenant_id":{"type":"string"},"user_id":{"type":"string"},"input":{"type":"object"},"input_json":{"type":"object"}},"additionalProperties":true}',
  NULL,
  'workflow_runtime,n8n,run,state_changing,audited',
  1,
  132
)
ON DUPLICATE KEY UPDATE
  `display_name` = VALUES(`display_name`),
  `description` = VALUES(`description`),
  `http_method` = VALUES(`http_method`),
  `http_path` = VALUES(`http_path`),
  `path_param_keys` = VALUES(`path_param_keys`),
  `input_schema` = VALUES(`input_schema`),
  `fixed_body` = VALUES(`fixed_body`),
  `tags` = VALUES(`tags`),
  `is_enabled` = VALUES(`is_enabled`),
  `sort_order` = VALUES(`sort_order`);
