-- Sprint 65: GPT schema DB registry coverage guard.
-- Purpose: keep DB-backed GPT/admin/tenant tool tables aligned with action, endpoint,
-- Platform Plugin, and app integration binding registries.
-- No secrets are inserted by this migration.

-- Repo inspection/mutation helpers are governed virtual admin tools from listAdminTools,
-- not DB-backed admin_platform_endpoint_tools rows.
UPDATE app_integration_tool_bindings
SET tool_surface = 'virtual_tool',
    notes = CONCAT(COALESCE(notes, ''), ' Runtime coverage correction: repo tools are virtual admin tools from listAdminTools, not DB-backed admin_platform_endpoint_tools.'),
    updated_at = CURRENT_TIMESTAMP
WHERE app_key = 'github'
  AND tool_key IN ('repo_inspect', 'repo_patch_apply')
  AND tool_surface <> 'virtual_tool';

-- Promoted Platform Plugin actions must still have registry authority rows so
-- app_integration_action_bindings never points at an orphan action_key.
INSERT INTO actions
  (action_key, action_title, status, module_binding, connector_family, runtime_callable, primary_executor, notes, created_at, updated_at)
VALUES
  ('crm.contact.list', 'CRM Contact List', 'active', 'platform_plugin_rest_adapter', 'platform_plugin', 'TRUE', 'platform_plugin_resolver', 'Seeded as registry authority for promoted Platform Plugin tenant.nagy_sample_crm_20260525 action binding. No secrets stored.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON DUPLICATE KEY UPDATE
  action_title = VALUES(action_title),
  status = VALUES(status),
  module_binding = VALUES(module_binding),
  connector_family = VALUES(connector_family),
  runtime_callable = VALUES(runtime_callable),
  primary_executor = VALUES(primary_executor),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO endpoints
  (endpoint_id, parent_action_key, endpoint_key, endpoint_operation, provider_domain, method, endpoint_path_or_function, route_target, openai_action_name, module_binding, connector_family, status, spec_validation_status, auth_validation_status, privacy_validation_status, execution_readiness, endpoint_role, execution_mode, transport_required, fallback_allowed, inventory_role, inventory_source, notes, created_at, updated_at, endpoint_title)
VALUES
  ('platform_plugin_crm_contact_list_v1', 'crm.contact.list', 'crm.contact.list', 'list_contacts', 'platform_plugin', 'GET', '/contacts', 'platform_plugin_contribution_private_dispatch_rest', 'crm_contact_list', 'platform_plugin_rest_adapter', 'platform_plugin', 'active', 'metadata_validated', 'tenant_connection_required', 'no_secret_return', 'ready', 'read', 'platform_plugin_rest', 'true', 'false', 'runtime_action', 'platform_plugin_promotion', 'Registry authority for promoted Platform Plugin action tenant.nagy_sample_crm_20260525::crm.contact.list. Execution remains resolver/grant gated.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'CRM Contact List')
ON DUPLICATE KEY UPDATE
  parent_action_key = VALUES(parent_action_key),
  endpoint_operation = VALUES(endpoint_operation),
  provider_domain = VALUES(provider_domain),
  method = VALUES(method),
  endpoint_path_or_function = VALUES(endpoint_path_or_function),
  route_target = VALUES(route_target),
  module_binding = VALUES(module_binding),
  connector_family = VALUES(connector_family),
  status = VALUES(status),
  spec_validation_status = VALUES(spec_validation_status),
  auth_validation_status = VALUES(auth_validation_status),
  privacy_validation_status = VALUES(privacy_validation_status),
  execution_readiness = VALUES(execution_readiness),
  endpoint_role = VALUES(endpoint_role),
  execution_mode = VALUES(execution_mode),
  transport_required = VALUES(transport_required),
  fallback_allowed = VALUES(fallback_allowed),
  inventory_role = VALUES(inventory_role),
  inventory_source = VALUES(inventory_source),
  notes = VALUES(notes),
  endpoint_title = VALUES(endpoint_title),
  updated_at = CURRENT_TIMESTAMP;

CREATE OR REPLACE VIEW v_gpt_schema_db_coverage_issues AS
SELECT
  'admin_missing_method_or_path' AS issue_type,
  tool_key AS issue_key,
  CONCAT('admin_platform_endpoint_tools.', tool_key, ' missing http_method or http_path') AS issue_detail
FROM admin_platform_endpoint_tools
WHERE is_enabled = 1
  AND (COALESCE(http_method, '') = '' OR COALESCE(http_path, '') = '')

UNION ALL
SELECT
  'tenant_missing_method_or_path',
  tool_key,
  CONCAT('tenant_platform_endpoint_tools.', tool_key, ' missing http_method or http_path')
FROM tenant_platform_endpoint_tools
WHERE is_enabled = 1
  AND (COALESCE(http_method, '') = '' OR COALESCE(http_path, '') = '')

UNION ALL
SELECT
  'admin_duplicate_tool_key',
  tool_key,
  CONCAT('admin_platform_endpoint_tools duplicate enabled tool_key: ', tool_key)
FROM admin_platform_endpoint_tools
WHERE is_enabled = 1
GROUP BY tool_key
HAVING COUNT(*) > 1

UNION ALL
SELECT
  'tenant_duplicate_tool_key',
  tool_key,
  CONCAT('tenant_platform_endpoint_tools duplicate enabled tool_key: ', tool_key)
FROM tenant_platform_endpoint_tools
WHERE is_enabled = 1
GROUP BY tool_key
HAVING COUNT(*) > 1

UNION ALL
SELECT
  'admin_bad_path',
  tool_key,
  CONCAT('admin_platform_endpoint_tools.', tool_key, ' has non-route http_path: ', COALESCE(http_path, ''))
FROM admin_platform_endpoint_tools
WHERE is_enabled = 1
  AND http_path NOT LIKE '/%'

UNION ALL
SELECT
  'tenant_bad_path',
  tool_key,
  CONCAT('tenant_platform_endpoint_tools.', tool_key, ' has non-route http_path: ', COALESCE(http_path, ''))
FROM tenant_platform_endpoint_tools
WHERE is_enabled = 1
  AND http_path NOT LIKE '/%'

UNION ALL
SELECT
  'export_missing_key',
  export_key,
  CONCAT('platform_endpoint_tool_exports.', export_key, ' missing parent_action_key, endpoint_key, or tool_name')
FROM platform_endpoint_tool_exports
WHERE status = 'active'
  AND (COALESCE(parent_action_key, '') = '' OR COALESCE(endpoint_key, '') = '' OR COALESCE(tool_name, '') = '')

UNION ALL
SELECT
  'export_missing_endpoint',
  x.export_key,
  CONCAT('platform_endpoint_tool_exports.', x.export_key, ' references missing endpoint_key: ', x.endpoint_key)
FROM platform_endpoint_tool_exports x
LEFT JOIN endpoints e ON e.endpoint_key = x.endpoint_key
WHERE x.status = 'active'
  AND e.endpoint_key IS NULL

UNION ALL
SELECT
  'export_missing_action',
  x.export_key,
  CONCAT('platform_endpoint_tool_exports.', x.export_key, ' references missing parent_action_key: ', x.parent_action_key)
FROM platform_endpoint_tool_exports x
LEFT JOIN actions a ON a.action_key = x.parent_action_key
WHERE x.status = 'active'
  AND a.action_key IS NULL

UNION ALL
SELECT
  'app_action_binding_missing_action',
  b.binding_id,
  CONCAT('app_integration_action_bindings.', b.binding_id, ' references missing action_key: ', b.action_key)
FROM app_integration_action_bindings b
LEFT JOIN actions a ON a.action_key = b.action_key
WHERE b.status = 'active'
  AND a.action_key IS NULL

UNION ALL
SELECT
  'app_tool_binding_missing_admin_tool',
  b.binding_id,
  CONCAT('app_integration_tool_bindings.', b.binding_id, ' references missing admin_platform_endpoint_tools tool_key: ', b.tool_key)
FROM app_integration_tool_bindings b
LEFT JOIN admin_platform_endpoint_tools t ON t.tool_key = b.tool_key AND t.is_enabled = 1
WHERE b.status = 'active'
  AND b.tool_surface = 'admin_platform_tool'
  AND t.tool_key IS NULL

UNION ALL
SELECT
  'app_tool_binding_missing_tenant_tool',
  b.binding_id,
  CONCAT('app_integration_tool_bindings.', b.binding_id, ' references missing tenant_platform_endpoint_tools tool_key: ', b.tool_key)
FROM app_integration_tool_bindings b
LEFT JOIN tenant_platform_endpoint_tools t ON t.tool_key = b.tool_key AND t.is_enabled = 1
WHERE b.status = 'active'
  AND b.tool_surface = 'tenant_platform_tool'
  AND t.tool_key IS NULL

UNION ALL
SELECT
  'app_tool_binding_missing_export',
  b.binding_id,
  CONCAT('app_integration_tool_bindings.', b.binding_id, ' references missing platform_endpoint_tool_exports tool_name: ', b.tool_key)
FROM app_integration_tool_bindings b
LEFT JOIN platform_endpoint_tool_exports x ON x.tool_name = b.tool_key AND x.status = 'active'
WHERE b.status = 'active'
  AND b.tool_surface = 'platform_endpoint_export'
  AND x.tool_name IS NULL;
