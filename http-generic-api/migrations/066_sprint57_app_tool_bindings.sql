-- Sprint 57: App integration tool bindings.
--
-- Links app catalog entries to governed admin/manual/device tools when the app
-- does not map directly to an actions/endpoints capability group.
--
-- This avoids creating fake actions for operational surfaces such as
-- Cloudflare device control, n8n local workflow control, and generic app
-- connection management.

CREATE TABLE IF NOT EXISTS `app_integration_tool_bindings` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `binding_id` VARCHAR(64) NOT NULL,
  `app_key` VARCHAR(64) NOT NULL,
  `tool_key` VARCHAR(128) NOT NULL,
  `tool_surface` ENUM('admin_platform_tool','tenant_platform_tool','system_tool','platform_endpoint_export','device_tool','virtual_tool') NOT NULL DEFAULT 'admin_platform_tool',
  `binding_role` ENUM('connection_management','credential_status','device_control','workflow_control','dns_control','app_install','diagnostic','read_only','state_changing','unknown') NOT NULL DEFAULT 'unknown',
  `credential_source` ENUM('user_connection','tenant_connection','platform_managed','device_connector','none','mixed') NOT NULL DEFAULT 'mixed',
  `exposure_scope` ENUM('admin','tenant','both') NOT NULL DEFAULT 'admin',
  `status` ENUM('active','pending','deprecated','archived') NOT NULL DEFAULT 'active',
  `notes` TEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_app_tool_binding_id` (`binding_id`),
  UNIQUE KEY `uq_app_tool_binding` (`app_key`, `tool_key`, `tool_surface`, `binding_role`),
  KEY `idx_app_tool_binding_app` (`app_key`),
  KEY `idx_app_tool_binding_tool` (`tool_key`),
  KEY `idx_app_tool_binding_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `app_integration_tool_bindings`
  (`binding_id`, `app_key`, `tool_key`, `tool_surface`, `binding_role`, `credential_source`, `exposure_scope`, `status`, `notes`)
VALUES
  ('bind_tool_cloudflare_connector_cf', 'cloudflare', 'connector_cf', 'device_tool', 'dns_control', 'platform_managed', 'admin', 'active', 'Cloudflare DNS/tunnel/cache recovery currently exposed through governed device Cloudflare tool'),
  ('bind_tool_n8n_connector_n8n', 'n8n', 'connector_n8n', 'device_tool', 'workflow_control', 'device_connector', 'admin', 'active', 'n8n local workflow control exposed through governed device n8n tool'),

  ('bind_tool_webhook_connection_create', 'webhook', 'admin_app_connection_create', 'admin_platform_tool', 'connection_management', 'user_connection', 'admin', 'active', 'Custom webhook app can be connected through generic app connection creation'),
  ('bind_tool_webhook_credential_status', 'webhook', 'credential_effective_status', 'admin_platform_tool', 'credential_status', 'user_connection', 'admin', 'active', 'Custom webhook credential binding can be inspected without exposing secrets'),

  ('bind_tool_mcp_connection_create', 'mcp', 'admin_app_connection_create', 'admin_platform_tool', 'connection_management', 'user_connection', 'admin', 'active', 'Generic MCP Server app can be connected through generic app connection creation'),
  ('bind_tool_mcp_credential_status', 'mcp', 'credential_effective_status', 'admin_platform_tool', 'credential_status', 'user_connection', 'admin', 'active', 'Generic MCP Server credential binding can be inspected without exposing secrets'),

  ('bind_tool_makecom_connection_create', 'makecom', 'admin_app_connection_create', 'admin_platform_tool', 'connection_management', 'user_connection', 'admin', 'active', 'Make.com API key app can be connected through generic app connection creation until a direct API action group is added'),
  ('bind_tool_makecom_credential_status', 'makecom', 'credential_effective_status', 'admin_platform_tool', 'credential_status', 'user_connection', 'admin', 'active', 'Make.com credential binding can be inspected without exposing secrets'),

  ('bind_tool_slack_connection_create', 'slack', 'admin_app_connection_create', 'admin_platform_tool', 'connection_management', 'user_connection', 'admin', 'active', 'Slack catalog entry currently has OAuth connection management but no runtime action group'),
  ('bind_tool_slack_credential_status', 'slack', 'credential_effective_status', 'admin_platform_tool', 'credential_status', 'user_connection', 'admin', 'active', 'Slack credential binding can be inspected without exposing secrets'),

  ('bind_tool_notion_connection_create', 'notion', 'admin_app_connection_create', 'admin_platform_tool', 'connection_management', 'user_connection', 'admin', 'active', 'Notion catalog entry currently has OAuth connection management but no runtime action group'),
  ('bind_tool_notion_credential_status', 'notion', 'credential_effective_status', 'admin_platform_tool', 'credential_status', 'user_connection', 'admin', 'active', 'Notion credential binding can be inspected without exposing secrets')
ON DUPLICATE KEY UPDATE
  `app_key` = VALUES(`app_key`),
  `tool_key` = VALUES(`tool_key`),
  `tool_surface` = VALUES(`tool_surface`),
  `binding_role` = VALUES(`binding_role`),
  `credential_source` = VALUES(`credential_source`),
  `exposure_scope` = VALUES(`exposure_scope`),
  `status` = VALUES(`status`),
  `notes` = VALUES(`notes`),
  `updated_at` = CURRENT_TIMESTAMP;

CREATE OR REPLACE VIEW `v_app_integration_tool_map` AS
SELECT
  ai.app_key,
  ai.display_name AS app_display_name,
  ai.category AS app_category,
  ai.auth_type AS app_auth_type,
  ai.status AS app_status,
  b.tool_key,
  b.tool_surface,
  b.binding_role,
  b.credential_source,
  b.exposure_scope,
  b.status AS binding_status,
  COALESCE(at.display_name, tt.display_name, b.tool_key) AS tool_display_name,
  COALESCE(at.http_method, tt.http_method) AS http_method,
  COALESCE(at.http_path, tt.http_path) AS http_path,
  COALESCE(at.tags, tt.tags) AS tags,
  COALESCE(uc.active_connections, 0) AS active_user_connections
FROM `app_integrations` ai
LEFT JOIN `app_integration_tool_bindings` b
  ON CONVERT(b.app_key USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(ai.app_key USING utf8mb4) COLLATE utf8mb4_unicode_ci
 AND b.status = 'active'
LEFT JOIN `admin_platform_endpoint_tools` at
  ON b.tool_surface IN ('admin_platform_tool', 'device_tool', 'virtual_tool')
 AND CONVERT(at.tool_key USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(b.tool_key USING utf8mb4) COLLATE utf8mb4_unicode_ci
LEFT JOIN `tenant_platform_endpoint_tools` tt
  ON b.tool_surface = 'tenant_platform_tool'
 AND CONVERT(tt.tool_key USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(b.tool_key USING utf8mb4) COLLATE utf8mb4_unicode_ci
LEFT JOIN (
  SELECT app_key, COUNT(*) AS active_connections
  FROM `user_app_connections`
  WHERE status = 'active'
  GROUP BY app_key
) uc
  ON CONVERT(uc.app_key USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(ai.app_key USING utf8mb4) COLLATE utf8mb4_unicode_ci;

CREATE OR REPLACE VIEW `v_app_integration_capability_map` AS
SELECT
  ai.app_key,
  ai.display_name AS app_display_name,
  ai.category AS app_category,
  ai.auth_type AS app_auth_type,
  ai.status AS app_status,
  b.action_key,
  b.binding_role,
  b.credential_source,
  b.exposure_default,
  b.status AS binding_status,
  a.connector_family,
  a.runtime_capability_class,
  a.runtime_callable,
  a.primary_executor,
  a.api_key_mode,
  COALESCE(ep.active_endpoints, 0) AS active_endpoints,
  COALESCE(tx.active_tool_exports, 0) AS active_tool_exports,
  COALESCE(tb.active_tool_bindings, 0) AS active_tool_bindings,
  COALESCE(tb.bound_tool_keys, '') AS bound_tool_keys,
  COALESCE(uc.active_connections, 0) AS active_user_connections
FROM `app_integrations` ai
LEFT JOIN `app_integration_action_bindings` b
  ON CONVERT(b.app_key USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(ai.app_key USING utf8mb4) COLLATE utf8mb4_unicode_ci
 AND b.status = 'active'
LEFT JOIN `actions` a
  ON CONVERT(a.action_key USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(b.action_key USING utf8mb4) COLLATE utf8mb4_unicode_ci
LEFT JOIN (
  SELECT parent_action_key, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_endpoints
  FROM `endpoints`
  GROUP BY parent_action_key
) ep
  ON CONVERT(ep.parent_action_key USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(b.action_key USING utf8mb4) COLLATE utf8mb4_unicode_ci
LEFT JOIN (
  SELECT parent_action_key, COUNT(*) AS active_tool_exports
  FROM `platform_endpoint_tool_exports`
  WHERE status = 'active'
  GROUP BY parent_action_key
) tx
  ON CONVERT(tx.parent_action_key USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(b.action_key USING utf8mb4) COLLATE utf8mb4_unicode_ci
LEFT JOIN (
  SELECT app_key, COUNT(*) AS active_tool_bindings, GROUP_CONCAT(tool_key ORDER BY tool_key SEPARATOR ', ') AS bound_tool_keys
  FROM `app_integration_tool_bindings`
  WHERE status = 'active'
  GROUP BY app_key
) tb
  ON CONVERT(tb.app_key USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(ai.app_key USING utf8mb4) COLLATE utf8mb4_unicode_ci
LEFT JOIN (
  SELECT app_key, COUNT(*) AS active_connections
  FROM `user_app_connections`
  WHERE status = 'active'
  GROUP BY app_key
) uc
  ON CONVERT(uc.app_key USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(ai.app_key USING utf8mb4) COLLATE utf8mb4_unicode_ci;
