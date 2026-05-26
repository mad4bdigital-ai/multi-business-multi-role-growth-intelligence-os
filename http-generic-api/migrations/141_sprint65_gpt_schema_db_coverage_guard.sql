-- Sprint 65: GPT schema DB table coverage guard.
-- Purpose: ensure tables that feed GPT schema/tool surfaces stay internally consistent.
-- No secrets are inserted or returned by this migration.

-- GitHub repo inspection/patching tools are virtual admin tools exposed by the admin tool facade,
-- not rows in admin_platform_endpoint_tools. Keep their plugin bindings classified accordingly.
UPDATE app_integration_tool_bindings
SET tool_surface = 'virtual_tool',
    binding_role = 'connection_management',
    credential_source = 'platform_managed',
    exposure_scope = 'admin',
    status = 'active',
    updated_at = CURRENT_TIMESTAMP
WHERE app_key = 'github'
  AND tool_key IN ('repo_inspect', 'repo_patch_apply');

INSERT INTO execution_policies
  (policy_group, policy_key, policy_value, active, execution_scope, affects_layer, blocking, notes)
SELECT
  'schema_governance',
  'gpt_schema_db_table_coverage',
  JSON_OBJECT(
    'tables', JSON_ARRAY(
      'admin_platform_endpoint_tools',
      'tenant_platform_endpoint_tools',
      'platform_endpoint_tool_exports',
      'actions',
      'endpoints',
      'app_integrations',
      'app_integration_action_bindings',
      'app_integration_tool_bindings',
      'platform_plugin_contributions'
    ),
    'required_checks', JSON_ARRAY(
      'tool rows must have method and path',
      'tool keys must be unique per tool registry',
      'platform endpoint exports must resolve endpoint/action keys',
      'app action bindings must resolve to actions or Platform Plugin contribution actions',
      'admin_platform_tool bindings must resolve admin_platform_endpoint_tools',
      'tenant_platform_tool bindings must resolve tenant_platform_endpoint_tools',
      'platform_endpoint_export bindings must resolve platform_endpoint_tool_exports',
      'virtual_tool bindings are allowed for facade-only tools such as repo_inspect and repo_patch_apply'
    )
  ),
  'true',
  'gpt_schema_generation',
  'db_tool_registry',
  'true',
  'Blocking governance policy for DB tables that feed GPT schema/tool surfaces. Validate with v_gpt_schema_db_coverage_issues before schema/runtime changes.'
WHERE NOT EXISTS (
  SELECT 1 FROM execution_policies
  WHERE policy_group = 'schema_governance'
    AND policy_key = 'gpt_schema_db_table_coverage'
);

UPDATE execution_policies
SET active = 'true',
    blocking = 'true',
    execution_scope = 'gpt_schema_generation',
    affects_layer = 'db_tool_registry',
    updated_at = CURRENT_TIMESTAMP
WHERE policy_group = 'schema_governance'
  AND policy_key = 'gpt_schema_db_table_coverage';

DROP VIEW IF EXISTS v_gpt_schema_db_coverage_issues;

CREATE VIEW v_gpt_schema_db_coverage_issues AS
SELECT
  'admin_missing_method_or_path' AS issue_type,
  tool_key AS subject_key,
  http_path AS subject_path,
  'admin_platform_endpoint_tools enabled row missing http_method or http_path' AS issue_detail
FROM admin_platform_endpoint_tools
WHERE is_enabled = 1
  AND (COALESCE(http_method, '') = '' OR COALESCE(http_path, '') = '')

UNION ALL
SELECT
  'tenant_missing_method_or_path',
  tool_key,
  http_path,
  'tenant_platform_endpoint_tools enabled row missing http_method or http_path'
FROM tenant_platform_endpoint_tools
WHERE is_enabled = 1
  AND (COALESCE(http_method, '') = '' OR COALESCE(http_path, '') = '')

UNION ALL
SELECT
  'admin_duplicate_tool_key',
  tool_key,
  NULL,
  'admin_platform_endpoint_tools has duplicate enabled tool_key'
FROM admin_platform_endpoint_tools
WHERE is_enabled = 1
GROUP BY tool_key
HAVING COUNT(*) > 1

UNION ALL
SELECT
  'tenant_duplicate_tool_key',
  tool_key,
  NULL,
  'tenant_platform_endpoint_tools has duplicate enabled tool_key'
FROM tenant_platform_endpoint_tools
WHERE is_enabled = 1
GROUP BY tool_key
HAVING COUNT(*) > 1

UNION ALL
SELECT
  'platform_export_missing_endpoint',
  x.tool_name,
  x.endpoint_key,
  'platform_endpoint_tool_exports active row references missing endpoint_key'
FROM platform_endpoint_tool_exports x
LEFT JOIN endpoints e ON e.endpoint_key = x.endpoint_key
WHERE x.status = 'active'
  AND e.endpoint_key IS NULL

UNION ALL
SELECT
  'platform_export_missing_action',
  x.tool_name,
  x.parent_action_key,
  'platform_endpoint_tool_exports active row references missing parent_action_key'
FROM platform_endpoint_tool_exports x
LEFT JOIN actions a ON a.action_key = x.parent_action_key
WHERE x.status = 'active'
  AND a.action_key IS NULL

UNION ALL
SELECT
  'app_action_binding_unresolved',
  b.app_key,
  b.action_key,
  'app_integration_action_bindings active action_key must resolve to actions or Platform Plugin contribution action_bindings_json'
FROM app_integration_action_bindings b
LEFT JOIN actions a ON a.action_key = b.action_key
LEFT JOIN platform_plugin_contributions c
  ON c.plugin_key = b.app_key
 AND JSON_SEARCH(c.action_bindings_json, 'one', b.action_key, NULL, '$[*].action_key') IS NOT NULL
WHERE b.status = 'active'
  AND a.action_key IS NULL
  AND c.contribution_id IS NULL

UNION ALL
SELECT
  'app_tool_binding_missing_admin_tool',
  b.app_key,
  b.tool_key,
  'admin_platform_tool binding must resolve to admin_platform_endpoint_tools; facade-only tools should use virtual_tool'
FROM app_integration_tool_bindings b
LEFT JOIN admin_platform_endpoint_tools t
  ON t.tool_key = b.tool_key
 AND t.is_enabled = 1
WHERE b.status = 'active'
  AND b.tool_surface = 'admin_platform_tool'
  AND t.tool_key IS NULL

UNION ALL
SELECT
  'app_tool_binding_missing_tenant_tool',
  b.app_key,
  b.tool_key,
  'tenant_platform_tool binding must resolve to tenant_platform_endpoint_tools'
FROM app_integration_tool_bindings b
LEFT JOIN tenant_platform_endpoint_tools t
  ON t.tool_key = b.tool_key
 AND t.is_enabled = 1
WHERE b.status = 'active'
  AND b.tool_surface = 'tenant_platform_tool'
  AND t.tool_key IS NULL

UNION ALL
SELECT
  'app_tool_binding_missing_platform_export',
  b.app_key,
  b.tool_key,
  'platform_endpoint_export binding must resolve to platform_endpoint_tool_exports'
FROM app_integration_tool_bindings b
LEFT JOIN platform_endpoint_tool_exports x
  ON x.tool_name = b.tool_key
 AND x.status = 'active'
WHERE b.status = 'active'
  AND b.tool_surface = 'platform_endpoint_export'
  AND x.tool_name IS NULL;
