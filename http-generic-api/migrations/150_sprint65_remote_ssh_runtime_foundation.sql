-- Sprint 65: Remote SSH Runtime foundation.
-- Purpose: generalize the older Hostinger SSH governed connector setup into a broader Platform Plugin
-- that can target either hosting accounts over governed SSH or local project paths through local connector paths.
-- This migration stores no plaintext SSH secrets and enables no arbitrary shell execution.

ALTER TABLE app_integrations
  MODIFY auth_type enum('oauth2','api_key','webhook','mcp','basic_auth','bearer_token','ssh_key_pair','local_path') NOT NULL;

ALTER TABLE user_app_connections
  MODIFY auth_type enum('oauth2','api_key','webhook','mcp','basic_auth','bearer_token','custom_headers','client_credentials','ssh_key_pair','local_path') NOT NULL;

ALTER TABLE credential_intake_sessions
  MODIFY auth_type enum('oauth2','api_key','webhook','mcp','basic_auth','bearer_token','custom_headers','client_credentials','ssh_key_pair','local_path') NOT NULL;

CREATE TABLE IF NOT EXISTS remote_runtime_targets (
  target_id varchar(36) NOT NULL,
  tenant_id varchar(64) NOT NULL,
  user_id varchar(64) DEFAULT NULL,
  plugin_key varchar(64) NOT NULL DEFAULT 'remote_ssh_runtime',
  target_kind enum('hosting_account','local_path') NOT NULL,
  provider_family varchar(64) DEFAULT NULL,
  connector_family varchar(64) DEFAULT NULL,
  system_id varchar(36) DEFAULT NULL,
  connection_id varchar(36) DEFAULT NULL,
  local_path_id varchar(36) DEFAULT NULL,
  host_label varchar(191) NOT NULL,
  root_path varchar(1024) DEFAULT NULL,
  path_allowlist_json longtext DEFAULT NULL CHECK (json_valid(path_allowlist_json)),
  command_allowlist_json longtext DEFAULT NULL CHECK (json_valid(command_allowlist_json)),
  metadata_json longtext DEFAULT NULL CHECK (json_valid(metadata_json)),
  status enum('planned','active','disabled','archived') NOT NULL DEFAULT 'planned',
  validation_status enum('unknown','pending_configuration','valid','invalid','inaccessible','partial') NOT NULL DEFAULT 'unknown',
  created_by varchar(191) DEFAULT NULL,
  updated_by varchar(191) DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (target_id),
  UNIQUE KEY uq_remote_runtime_system_target (system_id),
  UNIQUE KEY uq_remote_runtime_connection_target (connection_id),
  UNIQUE KEY uq_remote_runtime_local_path_target (local_path_id),
  KEY idx_remote_runtime_tenant_plugin (tenant_id, plugin_key, target_kind, status),
  KEY idx_remote_runtime_provider (provider_family, connector_family, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS remote_runtime_command_allowlists (
  command_id varchar(36) NOT NULL,
  plugin_key varchar(64) NOT NULL DEFAULT 'remote_ssh_runtime',
  command_key varchar(128) NOT NULL,
  display_name varchar(191) NOT NULL,
  target_kind enum('hosting_account','local_path','both') NOT NULL DEFAULT 'both',
  command_template varchar(1024) NOT NULL,
  input_schema_json longtext DEFAULT NULL CHECK (json_valid(input_schema_json)),
  risk_class enum('low','medium','high','admin_recovery') NOT NULL DEFAULT 'medium',
  requires_approval tinyint(1) NOT NULL DEFAULT 1,
  is_consequential tinyint(1) NOT NULL DEFAULT 1,
  output_policy enum('summary_only','bounded_text','artifact_reference') NOT NULL DEFAULT 'bounded_text',
  status enum('active','planned','disabled','archived') NOT NULL DEFAULT 'planned',
  notes text DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (command_id),
  UNIQUE KEY uq_remote_runtime_command (plugin_key, command_key),
  KEY idx_remote_runtime_command_target (plugin_key, target_kind, status, risk_class)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO app_integrations (
  app_key, display_name, description, auth_type, docs_url, category, default_action_grants, status
) VALUES (
  'remote_ssh_runtime',
  'Remote SSH Runtime',
  'Governed runtime for allowlisted operations against hosting SSH accounts or registered local project paths. Supports Hostinger SSH and local connector path targets without exposing arbitrary shell or plaintext secrets.',
  'ssh_key_pair',
  NULL,
  'infrastructure',
  JSON_ARRAY(
    JSON_OBJECT('action_key','remote_ssh.probe','auto_approve',true),
    JSON_OBJECT('action_key','remote_ssh.tail_logs','auto_approve',false),
    JSON_OBJECT('action_key','remote_ssh.exec_allowlisted','auto_approve',false),
    JSON_OBJECT('action_key','remote_ssh.deploy_pull','auto_approve',false),
    JSON_OBJECT('action_key','remote_ssh.restart_app','auto_approve',false),
    JSON_OBJECT('action_key','remote_ssh.local_path_status','auto_approve',true)
  ),
  'beta'
)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  description = VALUES(description),
  auth_type = VALUES(auth_type),
  category = VALUES(category),
  default_action_grants = VALUES(default_action_grants),
  status = VALUES(status);

INSERT INTO actions (
  action_key, status, module_binding, connector_family, runtime_capability_class,
  runtime_callable, primary_executor, action_title, action_class, action_scope,
  execution_layer, review_required, admin_only, notes
) VALUES
  ('remote_ssh.probe','active','remote_ssh_runtime','remote_ssh','remote_runtime_probe','true','remote_ssh_runtime','Remote SSH target probe','diagnostic','target','platform_plugin','false','false','Readiness probe for hosting-account or local-path remote runtime targets.'),
  ('remote_ssh.tail_logs','active','remote_ssh_runtime','remote_ssh','remote_runtime_logs','true','remote_ssh_runtime','Remote SSH tail logs','read','target','platform_plugin','true','false','Bounded log tail through allowlisted target operations.'),
  ('remote_ssh.exec_allowlisted','active','remote_ssh_runtime','remote_ssh','remote_runtime_allowlisted_command','true','remote_ssh_runtime','Remote SSH allowlisted command','state_changing','target','platform_plugin','true','false','Execute only commands registered in remote_runtime_command_allowlists.'),
  ('remote_ssh.deploy_pull','active','remote_ssh_runtime','remote_ssh','remote_runtime_deploy','true','remote_ssh_runtime','Remote SSH deploy pull','state_changing','target','platform_plugin','true','false','Allowlisted git pull / release deployment operation for hosting or local path targets.'),
  ('remote_ssh.restart_app','active','remote_ssh_runtime','remote_ssh','remote_runtime_restart','true','remote_ssh_runtime','Remote SSH restart app','state_changing','target','platform_plugin','true','false','Restart allowlisted app process. Production targets require approval/break-glass policy.'),
  ('remote_ssh.local_path_status','active','remote_ssh_runtime','local_connector','local_path_status','true','remote_ssh_runtime','Local project path status','diagnostic','target','local_connector','false','false','Read-only status for registered local_project_path_registry targets.')
ON DUPLICATE KEY UPDATE
  status = VALUES(status),
  module_binding = VALUES(module_binding),
  connector_family = VALUES(connector_family),
  runtime_capability_class = VALUES(runtime_capability_class),
  runtime_callable = VALUES(runtime_callable),
  primary_executor = VALUES(primary_executor),
  action_title = VALUES(action_title),
  action_class = VALUES(action_class),
  action_scope = VALUES(action_scope),
  execution_layer = VALUES(execution_layer),
  review_required = VALUES(review_required),
  admin_only = VALUES(admin_only),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO app_integration_action_bindings
  (binding_id, app_key, action_key, binding_role, credential_source, exposure_default, status, notes)
VALUES
  ('bind_remote_ssh_probe','remote_ssh_runtime','remote_ssh.probe','resolver','mixed','curated_exports','active','Read-only target readiness probe for hosting_account or local_path targets.'),
  ('bind_remote_ssh_tail_logs','remote_ssh_runtime','remote_ssh.tail_logs','transport','mixed','runtime_only','active','Bounded log tail through allowlisted command registry.'),
  ('bind_remote_ssh_exec_allowlisted','remote_ssh_runtime','remote_ssh.exec_allowlisted','transport','mixed','runtime_only','active','Execute only commands from remote_runtime_command_allowlists; no arbitrary shell.'),
  ('bind_remote_ssh_deploy_pull','remote_ssh_runtime','remote_ssh.deploy_pull','native_controller','mixed','runtime_only','active','Allowlisted deploy pull/release operation with approval gates.'),
  ('bind_remote_ssh_restart_app','remote_ssh_runtime','remote_ssh.restart_app','native_controller','mixed','runtime_only','active','Restart app process with production break-glass/approval gates.'),
  ('bind_remote_ssh_local_path_status','remote_ssh_runtime','remote_ssh.local_path_status','resolver','target_resolved','curated_exports','active','Local path read-only status through local_project_path_registry.')
ON DUPLICATE KEY UPDATE
  binding_role = VALUES(binding_role),
  credential_source = VALUES(credential_source),
  exposure_default = VALUES(exposure_default),
  status = VALUES(status),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO app_integration_tool_bindings
  (binding_id, app_key, tool_key, tool_surface, binding_role, credential_source, exposure_scope, status, notes)
VALUES
  ('bind_tool_remote_ssh_credential_intake','remote_ssh_runtime','credential_intake_session_create','admin_platform_tool','connection_management','user_connection','both','active','Create governed SSH credential intake sessions without exposing private keys.'),
  ('bind_tool_remote_ssh_connection_create','remote_ssh_runtime','admin_app_connection_create','admin_platform_tool','connection_management','user_connection','both','active','Create encrypted user_app_connections rows for SSH hosting account targets.'),
  ('bind_tool_remote_ssh_credential_status','remote_ssh_runtime','credential_effective_status','admin_platform_tool','credential_status','user_connection','both','active','Resolve SSH credential readiness without returning secret values.'),
  ('bind_tool_remote_ssh_hostinger_status','remote_ssh_runtime','hostinger_ssh_status','admin_platform_tool','diagnostic','platform_managed','admin','pending','Bridge to existing Hostinger SSH status tool once route validation is enabled.'),
  ('bind_tool_remote_ssh_hostinger_tail_logs','remote_ssh_runtime','hostinger_ssh_tail_logs','admin_platform_tool','read_only','platform_managed','admin','pending','Bridge to existing Hostinger SSH log tail tool once route validation is enabled.'),
  ('bind_tool_remote_ssh_hostinger_restart','remote_ssh_runtime','hostinger_ssh_restart_app','admin_platform_tool','state_changing','platform_managed','admin','pending','Bridge to existing Hostinger SSH restart tool once route validation is enabled.'),
  ('bind_tool_remote_ssh_local_shell','remote_ssh_runtime','local.connector.shell','virtual_tool','device_control','device_connector','both','active','Bridge to governed local gateway shell for registered local_path targets; requires allowlists and approval.'),
  ('bind_tool_remote_ssh_local_files','remote_ssh_runtime','local.connector.files','virtual_tool','device_control','device_connector','both','active','Bridge to governed local gateway files for registered local_path targets; requires path policy and approval.')
ON DUPLICATE KEY UPDATE
  tool_surface = VALUES(tool_surface),
  binding_role = VALUES(binding_role),
  credential_source = VALUES(credential_source),
  exposure_scope = VALUES(exposure_scope),
  status = VALUES(status),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO remote_runtime_command_allowlists
  (command_id, plugin_key, command_key, display_name, target_kind, command_template, input_schema_json, risk_class, requires_approval, is_consequential, output_policy, status, notes)
VALUES
  (UUID(),'remote_ssh_runtime','status','Target Status','both','remote_runtime:status',JSON_OBJECT('type','object','additionalProperties',false),'low',0,0,'summary_only','active','Read-only readiness/status check.'),
  (UUID(),'remote_ssh_runtime','tail_logs','Tail Logs','hosting_account','remote_runtime:ssh:tail_logs',JSON_OBJECT('type','object','required',JSON_ARRAY('app_key'),'properties',JSON_OBJECT('app_key',JSON_OBJECT('type','string'),'lines',JSON_OBJECT('type','integer','minimum',1,'maximum',300))),'medium',1,0,'bounded_text','active','Bounded log tail; never returns secret files.'),
  (UUID(),'remote_ssh_runtime','git_status','Git Status','local_path','remote_runtime:local:git_status',JSON_OBJECT('type','object','additionalProperties',false),'low',0,0,'bounded_text','active','Read-only git status for a registered local project path.'),
  (UUID(),'remote_ssh_runtime','deploy_pull','Deploy Pull','both','remote_runtime:deploy:pull',JSON_OBJECT('type','object','properties',JSON_OBJECT('branch',JSON_OBJECT('type','string'))),'high',1,1,'bounded_text','planned','Allowlisted deploy pull/release operation; implementation must verify branch and path allowlists.'),
  (UUID(),'remote_ssh_runtime','restart_app','Restart App','hosting_account','remote_runtime:ssh:restart_app',JSON_OBJECT('type','object','required',JSON_ARRAY('app_key','break_glass_reason'),'properties',JSON_OBJECT('app_key',JSON_OBJECT('type','string'),'break_glass_reason',JSON_OBJECT('type','string','minLength',12))),'admin_recovery',1,1,'bounded_text','planned','Production restart requires approval/break-glass reason.'),
  (UUID(),'remote_ssh_runtime','run_smoke','Run Smoke Test','local_path','remote_runtime:local:run_smoke',JSON_OBJECT('type','object','properties',JSON_OBJECT('script',JSON_OBJECT('type','string'))),'high',1,1,'bounded_text','planned','Local path smoke tests must map to allowlisted local connector commands.')
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  target_kind = VALUES(target_kind),
  command_template = VALUES(command_template),
  input_schema_json = VALUES(input_schema_json),
  risk_class = VALUES(risk_class),
  requires_approval = VALUES(requires_approval),
  is_consequential = VALUES(is_consequential),
  output_policy = VALUES(output_policy),
  status = VALUES(status),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO remote_runtime_targets (
  target_id, tenant_id, user_id, plugin_key, target_kind, provider_family, connector_family,
  system_id, connection_id, local_path_id, host_label, root_path, path_allowlist_json,
  command_allowlist_json, metadata_json, status, validation_status, created_by, updated_by
)
SELECT
  UUID(), cs.tenant_id, NULL, 'remote_ssh_runtime', 'hosting_account', cs.provider_family, cs.connector_family,
  cs.system_id, NULL, NULL, cs.display_name, NULL,
  JSON_EXTRACT(cs.config_json, '$.path_allowlist'),
  JSON_EXTRACT(cs.config_json, '$.command_allowlist'),
  JSON_OBJECT('source','connected_systems.hostinger_ssh','system_key',cs.system_key,'environment',JSON_UNQUOTE(JSON_EXTRACT(cs.config_json,'$.environment')),'service_mode',cs.service_mode,'secrets_included',false),
  CASE WHEN cs.status = 'active' THEN 'active' ELSE 'planned' END,
  CASE WHEN cs.status = 'active' THEN 'valid' ELSE 'pending_configuration' END,
  'migration_150_remote_ssh_runtime_foundation',
  'migration_150_remote_ssh_runtime_foundation'
FROM connected_systems cs
WHERE cs.connector_family = 'hostinger_ssh'
ON DUPLICATE KEY UPDATE
  tenant_id = VALUES(tenant_id),
  plugin_key = VALUES(plugin_key),
  target_kind = VALUES(target_kind),
  provider_family = VALUES(provider_family),
  connector_family = VALUES(connector_family),
  host_label = VALUES(host_label),
  path_allowlist_json = VALUES(path_allowlist_json),
  command_allowlist_json = VALUES(command_allowlist_json),
  metadata_json = VALUES(metadata_json),
  status = VALUES(status),
  validation_status = VALUES(validation_status),
  updated_by = VALUES(updated_by),
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO remote_runtime_targets (
  target_id, tenant_id, user_id, plugin_key, target_kind, provider_family, connector_family,
  system_id, connection_id, local_path_id, host_label, root_path, path_allowlist_json,
  command_allowlist_json, metadata_json, status, validation_status, created_by, updated_by
)
SELECT
  UUID(), lpr.tenant_id, lpr.user_id, 'remote_ssh_runtime', 'local_path', 'local', 'local_connector',
  NULL, NULL, lpr.path_id, COALESCE(lpr.project_label, lpr.project_key), lpr.current_path,
  JSON_ARRAY(lpr.current_path),
  lpr.allowed_operations_json,
  JSON_OBJECT('source','local_project_path_registry','device_id',lpr.device_id,'project_key',lpr.project_key,'repo_remote',lpr.repo_remote,'repo_branch',lpr.repo_branch,'secrets_included',false),
  CASE WHEN lpr.path_status = 'active' THEN 'active' ELSE 'planned' END,
  CASE WHEN lpr.validation_status = 'valid' THEN 'valid' WHEN lpr.validation_status IN ('missing','inaccessible') THEN 'inaccessible' ELSE 'unknown' END,
  'migration_150_remote_ssh_runtime_foundation',
  'migration_150_remote_ssh_runtime_foundation'
FROM local_project_path_registry lpr
WHERE lpr.path_status IN ('active','pending_move','repair_required')
ON DUPLICATE KEY UPDATE
  tenant_id = VALUES(tenant_id),
  user_id = VALUES(user_id),
  plugin_key = VALUES(plugin_key),
  target_kind = VALUES(target_kind),
  provider_family = VALUES(provider_family),
  connector_family = VALUES(connector_family),
  host_label = VALUES(host_label),
  root_path = VALUES(root_path),
  path_allowlist_json = VALUES(path_allowlist_json),
  command_allowlist_json = VALUES(command_allowlist_json),
  metadata_json = VALUES(metadata_json),
  status = VALUES(status),
  validation_status = VALUES(validation_status),
  updated_by = VALUES(updated_by),
  updated_at = CURRENT_TIMESTAMP;

CREATE OR REPLACE VIEW v_remote_runtime_target_coverage_issues AS
SELECT 'hosting_target_missing_system_or_connection' AS issue_type, target_id, tenant_id, plugin_key, target_kind, host_label
FROM remote_runtime_targets
WHERE target_kind = 'hosting_account'
  AND system_id IS NULL
  AND connection_id IS NULL
UNION ALL
SELECT 'local_target_missing_path_id' AS issue_type, target_id, tenant_id, plugin_key, target_kind, host_label
FROM remote_runtime_targets
WHERE target_kind = 'local_path'
  AND local_path_id IS NULL
UNION ALL
SELECT 'target_missing_path_allowlist' AS issue_type, target_id, tenant_id, plugin_key, target_kind, host_label
FROM remote_runtime_targets
WHERE path_allowlist_json IS NULL
UNION ALL
SELECT 'target_missing_command_allowlist' AS issue_type, target_id, tenant_id, plugin_key, target_kind, host_label
FROM remote_runtime_targets
WHERE command_allowlist_json IS NULL
UNION ALL
SELECT 'command_allowlist_missing_active_probe' AS issue_type, NULL AS target_id, NULL AS tenant_id, 'remote_ssh_runtime' AS plugin_key, 'both' AS target_kind, 'remote_ssh.probe/status' AS host_label
WHERE NOT EXISTS (
  SELECT 1 FROM remote_runtime_command_allowlists
  WHERE plugin_key='remote_ssh_runtime' AND command_key='status' AND status='active'
);
