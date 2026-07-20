-- Temporary exact resource-authority binding for enabling the read-only Hostinger SSH probe gate.
-- Safety contract: no deploy, no restart, no provider dispatch, no credential payload read, no secret return.
-- The binding expires automatically after 60 minutes and authorizes only one platform_runtime_config key update mode.
INSERT INTO platform_resource_authority_bindings (
  binding_id,
  tenant_id,
  workspace_id,
  user_id,
  resource_type,
  resource_uri,
  resource_ref_json,
  recipe_key,
  permission_level,
  allowed_modes_json,
  authority_source,
  expires_at,
  status,
  notes,
  created_by,
  created_at,
  updated_at
)
VALUES (
  'ccdf0db1-1d66-48d4-a92b-e9433a92bd10',
  '00000000-0000-0000-0000-000000000000',
  'b50db01b-617e-4b7a-8bda-6bf4876f754f',
  'platform_admin',
  'platform_runtime_config',
  'platform_runtime_config://remote_runtime_hostinger_ssh_probe_enabled',
  JSON_OBJECT(
    'config_key', 'remote_runtime_hostinger_ssh_probe_enabled',
    'target_id', 'b49fe2ae-5974-11f1-9baf-8e76a7e1749f',
    'app_key', 'auth.mad4b.com',
    'purpose', 'temporary_read_only_origin_probe_after_auth_502_20260711',
    'deploy_allowed', false,
    'restart_allowed', false,
    'provider_dispatch_allowed', false,
    'credential_payload_read_allowed', false,
    'secrets_included', false
  ),
  'remote_runtime_hostinger_ssh_probe',
  'admin',
  JSON_ARRAY('platform_runtime_config_update'),
  'governed_migration_temporary_hostinger_probe_config_authority',
  DATE_ADD(UTC_TIMESTAMP(), INTERVAL 60 MINUTE),
  'active',
  'Temporary exact authority binding to enable only the read-only Hostinger SSH probe DB gate for auth.mad4b.com 502 diagnosis. It does not authorize deploy, restart, provider dispatch, credential payload reads, or secret return.',
  'admin_gpt',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON DUPLICATE KEY UPDATE
  tenant_id = VALUES(tenant_id),
  workspace_id = VALUES(workspace_id),
  user_id = VALUES(user_id),
  resource_type = VALUES(resource_type),
  resource_uri = VALUES(resource_uri),
  resource_ref_json = VALUES(resource_ref_json),
  recipe_key = VALUES(recipe_key),
  permission_level = VALUES(permission_level),
  allowed_modes_json = VALUES(allowed_modes_json),
  authority_source = VALUES(authority_source),
  expires_at = VALUES(expires_at),
  status = 'active',
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;
