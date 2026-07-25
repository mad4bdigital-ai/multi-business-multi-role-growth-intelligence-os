-- Repair repository authority and capability readiness without mutating the legacy self-serve GitHub connector.

INSERT INTO connected_systems (
  system_id,
  tenant_id,
  system_key,
  display_name,
  provider_family,
  provider_domain,
  connector_family,
  auth_type,
  service_mode,
  self_serve_capable,
  assisted_capable,
  managed_capable,
  config_json,
  status,
  created_at,
  updated_at
) VALUES (
  '5a9f7f72-8d1c-4e9a-9d9d-4c0d8a5e7b21',
  '00000000-0000-0000-0000-000000000000',
  'github_api_mcp_platform_managed',
  'GitHub API MCP Platform Managed',
  'github',
  'api.github.com',
  'github_api_mcp',
  'oauth2',
  'managed',
  0,
  1,
  1,
  JSON_OBJECT(
    'authority_source', 'activation_bootstrap_config',
    'parent_action_key', 'github_api_mcp',
    'credential_source', 'platform_managed',
    'secrets_included', FALSE
  ),
  'active',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  provider_family = VALUES(provider_family),
  provider_domain = VALUES(provider_domain),
  connector_family = VALUES(connector_family),
  auth_type = VALUES(auth_type),
  service_mode = VALUES(service_mode),
  self_serve_capable = VALUES(self_serve_capable),
  assisted_capable = VALUES(assisted_capable),
  managed_capable = VALUES(managed_capable),
  config_json = VALUES(config_json),
  status = VALUES(status),
  updated_at = CURRENT_TIMESTAMP;

UPDATE repository_authority_bindings AS rab
JOIN connected_systems AS cs
  ON cs.tenant_id = '00000000-0000-0000-0000-000000000000'
 AND cs.system_key = 'github_api_mcp_platform_managed'
 AND cs.status = 'active'
 AND cs.managed_capable = 1
SET rab.system_id = cs.system_id,
    rab.system_binding_mode = 'shared_platform_adapter',
    rab.binding_version = rab.binding_version + 1,
    rab.lock_version = rab.lock_version + 1,
    rab.updated_at = CURRENT_TIMESTAMP
WHERE rab.binding_key = 'growth_intelligence_platform.github.primary.production'
  AND rab.lifecycle_status = 'active'
  AND (
    rab.system_id <> cs.system_id
    OR rab.system_binding_mode <> 'shared_platform_adapter'
  );

UPDATE capability_apply_authorization_policy_registry
SET policy_key = 'github_repository_main_moved_webhook_dynamic_binding_apply_v2',
    notes = CONCAT(
      COALESCE(NULLIF(TRIM(notes), ''), 'GitHub repository webhook apply policy.'),
      ' [policy key aligned with repository capability binding]'
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE policy_key = 'github_repository_main_moved_webhook_provision_apply_v1'
  AND app_key = 'github'
  AND capability_key = 'github_repository_main_moved_webhook_provision'
  AND runtime_surface = 'repo_patch_apply';
