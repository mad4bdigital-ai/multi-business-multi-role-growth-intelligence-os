-- 108_hostinger_ssh_governed_connectors.sql
-- Purpose: register separate governed Hostinger SSH surfaces for production and development.
-- This migration stores no SSH secrets. Secret references point to env/vault placeholders only.
-- Direct arbitrary SSH is forbidden; execution must route through named allowlisted operations.

SET @platform_tenant_id = 'f2795a7f-8d06-4053-8bee-35ca9af8b460';

INSERT INTO connected_systems (
  system_id, tenant_id, system_key, display_name, provider_family, provider_domain,
  connector_family, auth_type, service_mode, self_serve_capable, assisted_capable,
  managed_capable, status, config_json
) VALUES (
  UUID(), @platform_tenant_id, 'hostinger_ssh_prod_platform',
  'Hostinger SSH - Production Platform Apps', 'hostinger', 'hostinger.com',
  'hostinger_ssh', 'ssh_key_pair', 'managed', 0, 1, 1, 'pending',
  JSON_OBJECT(
    'source','migration_108',
    'environment','production',
    'purpose','server_level_deploy_log_restart_recovery',
    'required_for',JSON_ARRAY('auth.mad4b.com','connector.mad4b.com','api.mad4b.com_when_hostinger_deployed'),
    'path_allowlist',JSON_ARRAY('/home/*/domains/auth.mad4b.com','/home/*/domains/connector.mad4b.com','/home/*/domains/api.mad4b.com'),
    'command_allowlist',JSON_ARRAY('status','tail_logs','restart_app','deploy_release','rollback_release'),
    'approval_required',true,
    'break_glass_required_for',JSON_ARRAY('restart_app','rollback_release','manual_command'),
    'secret_refs',JSON_OBJECT('host','HOSTINGER_PROD_SSH_HOST','port','HOSTINGER_PROD_SSH_PORT','user','HOSTINGER_PROD_SSH_USER','private_key','HOSTINGER_PROD_SSH_PRIVATE_KEY')
  )
) ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  provider_family = VALUES(provider_family),
  connector_family = VALUES(connector_family),
  auth_type = VALUES(auth_type),
  service_mode = VALUES(service_mode),
  status = VALUES(status),
  config_json = VALUES(config_json);

INSERT INTO connected_systems (
  system_id, tenant_id, system_key, display_name, provider_family, provider_domain,
  connector_family, auth_type, service_mode, self_serve_capable, assisted_capable,
  managed_capable, status, config_json
) VALUES (
  UUID(), @platform_tenant_id, 'hostinger_ssh_dev_platform',
  'Hostinger SSH - Dev Platform Apps', 'hostinger', 'hostinger.com',
  'hostinger_ssh', 'ssh_key_pair', 'managed', 0, 1, 1, 'pending',
  JSON_OBJECT(
    'source','migration_108',
    'environment','development',
    'purpose','server_level_dev_deploy_log_restart_recovery',
    'required_for',JSON_ARRAY('dev.mad4b.com','staging auth/connector when Hostinger deployed'),
    'path_allowlist',JSON_ARRAY('/home/*/domains/dev.mad4b.com','/home/*/domains/staging-auth.mad4b.com','/home/*/domains/staging-connector.mad4b.com'),
    'command_allowlist',JSON_ARRAY('status','tail_logs','restart_app','deploy_release','rollback_release'),
    'approval_required',false,
    'break_glass_required_for',JSON_ARRAY('manual_command'),
    'secret_refs',JSON_OBJECT('host','HOSTINGER_DEV_SSH_HOST','port','HOSTINGER_DEV_SSH_PORT','user','HOSTINGER_DEV_SSH_USER','private_key','HOSTINGER_DEV_SSH_PRIVATE_KEY')
  )
) ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  provider_family = VALUES(provider_family),
  connector_family = VALUES(connector_family),
  auth_type = VALUES(auth_type),
  service_mode = VALUES(service_mode),
  status = VALUES(status),
  config_json = VALUES(config_json);

INSERT INTO secret_references (
  ref_id, tenant_id, owner_type, owner_id, system_id, provider_family, connector_family,
  credential_type, scope_json, consent_status, rotation_status, validation_status,
  status, secret_key, store_type, env_var_name, description
)
SELECT UUID(), @platform_tenant_id, 'platform', 'platform-system', cs.system_id,
       'hostinger', 'hostinger_ssh', refs.credential_type,
       JSON_OBJECT('environment', refs.environment, 'plaintext_forbidden', refs.plaintext_forbidden),
       'not_required', 'pending_configuration', 'pending_configuration', 'disabled',
       refs.secret_key, 'env', refs.env_var_name, refs.description
FROM connected_systems cs
JOIN (
  SELECT 'hostinger_ssh_prod_platform' AS system_key, 'production' AS environment, 'ssh_host' AS credential_type, 'hostinger_ssh_prod_host' AS secret_key, 'HOSTINGER_PROD_SSH_HOST' AS env_var_name, 'Production Hostinger SSH host placeholder' AS description, false AS plaintext_forbidden
  UNION ALL SELECT 'hostinger_ssh_prod_platform','production','ssh_port','hostinger_ssh_prod_port','HOSTINGER_PROD_SSH_PORT','Production Hostinger SSH port placeholder',false
  UNION ALL SELECT 'hostinger_ssh_prod_platform','production','ssh_user','hostinger_ssh_prod_user','HOSTINGER_PROD_SSH_USER','Production Hostinger SSH user placeholder',false
  UNION ALL SELECT 'hostinger_ssh_prod_platform','production','ssh_private_key','hostinger_ssh_prod_private_key','HOSTINGER_PROD_SSH_PRIVATE_KEY','Production Hostinger SSH private key env placeholder',true
  UNION ALL SELECT 'hostinger_ssh_dev_platform','development','ssh_host','hostinger_ssh_dev_host','HOSTINGER_DEV_SSH_HOST','Development Hostinger SSH host placeholder',false
  UNION ALL SELECT 'hostinger_ssh_dev_platform','development','ssh_port','hostinger_ssh_dev_port','HOSTINGER_DEV_SSH_PORT','Development Hostinger SSH port placeholder',false
  UNION ALL SELECT 'hostinger_ssh_dev_platform','development','ssh_user','hostinger_ssh_dev_user','HOSTINGER_DEV_SSH_USER','Development Hostinger SSH user placeholder',false
  UNION ALL SELECT 'hostinger_ssh_dev_platform','development','ssh_private_key','hostinger_ssh_dev_private_key','HOSTINGER_DEV_SSH_PRIVATE_KEY','Development Hostinger SSH private key env placeholder',true
) refs ON refs.system_key = cs.system_key
WHERE cs.tenant_id = @platform_tenant_id
  AND NOT EXISTS (
    SELECT 1 FROM secret_references sr
    WHERE sr.tenant_id = @platform_tenant_id
      AND sr.system_id = cs.system_id
      AND sr.secret_key = refs.secret_key
  );

-- Tools are intentionally registered disabled until routes/credential validation are implemented.
INSERT INTO admin_platform_endpoint_tools (
  tool_key, display_name, description, http_method, http_path, path_param_keys,
  input_schema, fixed_body, tags, is_enabled, sort_order
) VALUES
('hostinger_ssh_status','Hostinger SSH Status','Check governed Hostinger SSH configuration readiness without exposing secrets.','POST','/admin/hostinger/ssh/status',NULL,JSON_OBJECT('type','object','required',JSON_ARRAY('environment'),'properties',JSON_OBJECT('environment',JSON_OBJECT('type','string','enum',JSON_ARRAY('production','development')))),NULL,'hostinger,ssh,governed,diagnostics',0,240),
('hostinger_ssh_tail_logs','Hostinger SSH Tail Logs','Tail allowlisted Hostinger app logs through governed SSH.','POST','/admin/hostinger/ssh/tail-logs',NULL,JSON_OBJECT('type','object','required',JSON_ARRAY('environment','app_key'),'properties',JSON_OBJECT('environment',JSON_OBJECT('type','string','enum',JSON_ARRAY('production','development')),'app_key',JSON_OBJECT('type','string'),'lines',JSON_OBJECT('type','integer','minimum',1,'maximum',300))),NULL,'hostinger,ssh,logs,governed',0,241),
('hostinger_ssh_restart_app','Hostinger SSH Restart App','Restart allowlisted Hostinger app process. Production requires approval and break-glass reason.','POST','/admin/hostinger/ssh/restart-app',NULL,JSON_OBJECT('type','object','required',JSON_ARRAY('environment','app_key'),'properties',JSON_OBJECT('environment',JSON_OBJECT('type','string','enum',JSON_ARRAY('production','development')),'app_key',JSON_OBJECT('type','string'),'break_glass_reason',JSON_OBJECT('type','string'))),NULL,'hostinger,ssh,restart,governed,break_glass',0,242)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  http_method = VALUES(http_method),
  http_path = VALUES(http_path),
  input_schema = VALUES(input_schema),
  tags = VALUES(tags),
  is_enabled = VALUES(is_enabled),
  sort_order = VALUES(sort_order);
