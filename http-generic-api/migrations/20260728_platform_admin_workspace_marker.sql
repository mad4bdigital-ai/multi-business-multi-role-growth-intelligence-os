-- Mark the existing canonical workspace explicitly for platform topology verification.
-- This is idempotent and preserves all existing config_json properties.

UPDATE workspace_registry
SET
  config_json = JSON_SET(
    CASE
      WHEN JSON_VALID(COALESCE(config_json, '')) THEN config_json
      ELSE JSON_OBJECT()
    END,
    '$.authority_scope_key',
    'platform:root',
    '$.platform_admin_workspace',
    TRUE
  ),
  updated_at = CURRENT_TIMESTAMP
WHERE workspace_id = 'b50db01b-617e-4b7a-8bda-6bf4876f754f'
  AND tenant_id = '00000000-0000-0000-0000-000000000000'
  AND workspace_key = 'platform_repo_governance_zero';
