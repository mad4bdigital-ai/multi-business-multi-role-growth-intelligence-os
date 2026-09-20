-- Recreate the canonical Platform Admin workspace during an official schema-only
-- Staging rebuild. Conflicting ID/key rows are intentionally left untouched so
-- the exact semantic readback fails closed instead of rewriting another identity.

INSERT INTO workspace_registry (
  workspace_id, tenant_id, workspace_key, display_name, workspace_type,
  bootstrap_status, config_json
)
SELECT
  'b50db01b-617e-4b7a-8bda-6bf4876f754f',
  '00000000-0000-0000-0000-000000000000',
  'platform_repo_governance_zero',
  'Platform Admin',
  'brand',
  'ready',
  JSON_OBJECT('authority_scope_key', 'platform:root', 'platform_admin_workspace', TRUE)
WHERE NOT EXISTS (
  SELECT 1 FROM workspace_registry
  WHERE workspace_id = 'b50db01b-617e-4b7a-8bda-6bf4876f754f'
     OR (tenant_id = '00000000-0000-0000-0000-000000000000'
         AND workspace_key = 'platform_repo_governance_zero')
);

UPDATE workspace_registry
SET config_json = JSON_SET(
      CASE WHEN JSON_VALID(COALESCE(config_json, '')) THEN config_json ELSE JSON_OBJECT() END,
      '$.authority_scope_key', 'platform:root',
      '$.platform_admin_workspace', TRUE
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE workspace_id = 'b50db01b-617e-4b7a-8bda-6bf4876f754f'
  AND tenant_id = '00000000-0000-0000-0000-000000000000'
  AND workspace_key = 'platform_repo_governance_zero';
