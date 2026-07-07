-- Temporary Hostinger deploy resource authority binding for production parity recovery.
-- Safety contract: no_provider_call, no_credential_payload_read, no_raw_secrets, no_external_send, no_external_write, secrets_included=false.
-- This migration does not deploy, restart, call providers, read credential payloads, or expose secrets.
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
  'a8ec8ed2-5ba7-4b33-98ac-f6f51076ce38',
  '00000000-0000-0000-0000-000000000000',
  'b50db01b-617e-4b7a-8bda-6bf4876f754f',
  'f242960c-2857-4b4d-a504-ee50f8a278b4',
  'remote_runtime_target',
  'hostinger://auth.mad4b.com/production',
  JSON_OBJECT(
    'target_id', 'b49fe2ae-5974-11f1-9baf-8e76a7e1749f',
    'app_key', 'auth.mad4b.com',
    'purpose', 'temporary_hostinger_deploy_resource_authority_20260706',
    'provider_dispatch_allowed', false,
    'credential_payload_read_allowed', false,
    'secrets_included', false
  ),
  'remote_runtime_hostinger_deploy_release',
  'admin',
  JSON_ARRAY('deploy'),
  'governed_admin_bootstrap_tool',
  DATE_ADD(UTC_TIMESTAMP(), INTERVAL 2 HOUR),
  'active',
  'Temporary resource authority binding for one governed Hostinger deploy-release parity attempt. Deploy still requires dry-run dispatch_ready, approved capability envelope, bounded execution, and post-deploy readback. Disable or allow expiry after parity verification.',
  'gpt_admin',
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
