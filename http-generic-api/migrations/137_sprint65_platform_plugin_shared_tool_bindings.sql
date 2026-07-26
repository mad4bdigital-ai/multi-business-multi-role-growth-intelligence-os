-- Sprint 65: shared Platform Plugin tool bindings.
-- Purpose: make every active/beta Platform Plugin use the same governed credential/status surfaces,
-- while binding local connector bridges only for plugins with a matching governed device tool.
-- No secrets are inserted by this migration.

INSERT INTO app_integration_tool_bindings
  (binding_id, app_key, tool_key, tool_surface, binding_role, credential_source, exposure_scope, status, notes)
SELECT
  CONCAT('bind_tool_', REPLACE(REPLACE(REPLACE(app_key,'.','_'),':','_'),'-','_'), '_credential_intake'),
  app_key,
  'credential_intake_session_create',
  'admin_platform_tool',
  'connection_management',
  'user_connection',
  'admin',
  'active',
  'Common Platform Plugin binding: create secure credential intake sessions without exposing secrets.'
FROM app_integrations
WHERE status IN ('active','beta')
ON DUPLICATE KEY UPDATE
  tool_surface = VALUES(tool_surface),
  binding_role = VALUES(binding_role),
  credential_source = VALUES(credential_source),
  exposure_scope = VALUES(exposure_scope),
  status = VALUES(status),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO app_integration_tool_bindings
  (binding_id, app_key, tool_key, tool_surface, binding_role, credential_source, exposure_scope, status, notes)
SELECT
  CONCAT('bind_tool_', REPLACE(REPLACE(REPLACE(app_key,'.','_'),':','_'),'-','_'), '_connection_create'),
  app_key,
  'admin_app_connection_create',
  'admin_platform_tool',
  'connection_management',
  'user_connection',
  'admin',
  'active',
  'Common Platform Plugin binding: create encrypted user_app_connections rows through governed backend route.'
FROM app_integrations
WHERE status IN ('active','beta')
ON DUPLICATE KEY UPDATE
  tool_surface = VALUES(tool_surface),
  binding_role = VALUES(binding_role),
  credential_source = VALUES(credential_source),
  exposure_scope = VALUES(exposure_scope),
  status = VALUES(status),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO app_integration_tool_bindings
  (binding_id, app_key, tool_key, tool_surface, binding_role, credential_source, exposure_scope, status, notes)
SELECT
  CONCAT('bind_tool_', REPLACE(REPLACE(REPLACE(app_key,'.','_'),':','_'),'-','_'), '_credential_status'),
  app_key,
  'credential_effective_status',
  'admin_platform_tool',
  'credential_status',
  'user_connection',
  'admin',
  'active',
  'Common Platform Plugin binding: resolve effective credential status without returning secret values.'
FROM app_integrations
WHERE status IN ('active','beta')
ON DUPLICATE KEY UPDATE
  tool_surface = VALUES(tool_surface),
  binding_role = VALUES(binding_role),
  credential_source = VALUES(credential_source),
  exposure_scope = VALUES(exposure_scope),
  status = VALUES(status),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO app_integration_tool_bindings
  (binding_id, app_key, tool_key, tool_surface, binding_role, credential_source, exposure_scope, status, notes)
VALUES
  ('bind_tool_github_repo_inspect', 'github', 'repo_inspect', 'admin_platform_tool', 'connection_management', 'platform_managed', 'admin', 'active', 'GitHub Platform Plugin shared HTTP client read surface via GitHub App/backend credential.'),
  ('bind_tool_github_repo_patch_apply', 'github', 'repo_patch_apply', 'admin_platform_tool', 'connection_management', 'platform_managed', 'admin', 'active', 'GitHub Platform Plugin shared HTTP client mutation surface via GitHub App/backend credential.'),
  ('bind_tool_github_admin_control', 'github', 'admin_control', 'admin_platform_tool', 'connection_management', 'platform_managed', 'admin', 'active', 'GitHub Platform Plugin shared admin control path; prefer auth-host GitHub REST/GitHub App over local PAT.'),
  ('bind_tool_github_connector_github', 'github', 'connector_github', 'device_tool', 'connection_management', 'device_connector', 'admin', 'active', 'Local connector GitHub CLI bridge; prefer platform-managed HTTP/GitHub App fallback when device auth is missing.'),
  ('bind_tool_google_cloud_connector_gcloud', 'google_cloud', 'connector_gcloud', 'device_tool', 'connection_management', 'device_connector', 'admin', 'active', 'Local connector gcloud CLI bridge; use only when device credential validates.'),
  ('bind_tool_cloudflare_connector_cf', 'cloudflare', 'connector_cf', 'device_tool', 'dns_control', 'platform_managed', 'admin', 'active', 'Cloudflare device bridge for tunnel/DNS recovery through governed connector path.'),
  ('bind_tool_n8n_connector_n8n', 'n8n', 'connector_n8n', 'device_tool', 'workflow_control', 'device_connector', 'admin', 'active', 'n8n device bridge for local workflow control through governed connector path.')
ON DUPLICATE KEY UPDATE
  tool_surface = VALUES(tool_surface),
  binding_role = VALUES(binding_role),
  credential_source = VALUES(credential_source),
  exposure_scope = VALUES(exposure_scope),
  status = VALUES(status),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;
