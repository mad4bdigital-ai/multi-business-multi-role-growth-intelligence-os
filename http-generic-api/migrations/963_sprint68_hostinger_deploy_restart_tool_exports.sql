-- 963_sprint68_hostinger_deploy_restart_tool_exports.sql
-- Purpose: support all production parity recovery options by binding Hostinger
-- deploy/restart admin tools to the Hostinger app integration and endpoint export
-- map. This does not execute deploy/restart and does not expose secrets.
-- Safety: No provider calls. No credential payload reads. No raw secrets. No external send. No external writes. secrets_included=false

INSERT INTO platform_endpoint_tool_exports (
  export_key, parent_action_key, endpoint_key, tool_name, scope_class, status,
  import_policy_json, input_schema_json, auth_policy_json, execution_policy_json, notes
)
VALUES
  (
    'hostinger_api.remote_runtime_hostinger_deploy_release.admin_export',
    'hostinger_api',
    'remote_runtime_hostinger_deploy_release',
    'remote_runtime_hostinger_deploy_release',
    'admin',
    'active',
    JSON_OBJECT('source','sprint68_hostinger_deploy_restart_tool_exports','no_inline_secret',true,'secrets_included',false),
    JSON_OBJECT('type','object','required',JSON_ARRAY('target_id','app_key','app_path','branch','expected_commit_sha'),'properties',JSON_OBJECT('target_id',JSON_OBJECT('type','string'),'app_key',JSON_OBJECT('type','string','enum',JSON_ARRAY('auth.mad4b.com')),'app_path',JSON_OBJECT('type','string'),'branch',JSON_OBJECT('type','string','enum',JSON_ARRAY('main')),'expected_commit_sha',JSON_OBJECT('type','string'),'dry_run',JSON_OBJECT('type','boolean','default',true),'restart',JSON_OBJECT('type','boolean','default',true),'capability_envelope_id',JSON_OBJECT('type','string'))),
    JSON_OBJECT('auth_source','stored_hostinger_ssh_or_api_binding','inline_secret_allowed',false,'secrets_included',false),
    JSON_OBJECT('requires_capability_envelope_for_apply',true,'requires_expected_sha',true,'requires_path_allowlist',true,'requires_readback',true,'freeform_shell_allowed',false,'secrets_included',false),
    'Admin export for governed Hostinger deploy-release option. Dry-run/readback first; actual execution requires capability envelope and feature flag.'
  ),
  (
    'hostinger_api.hostinger_ssh_restart_app.admin_export',
    'hostinger_api',
    'hostinger_ssh_restart_app',
    'hostinger_ssh_restart_app',
    'admin',
    'active',
    JSON_OBJECT('source','sprint68_hostinger_deploy_restart_tool_exports','no_inline_secret',true,'secrets_included',false),
    JSON_OBJECT('type','object','required',JSON_ARRAY('environment','app_key'),'properties',JSON_OBJECT('environment',JSON_OBJECT('type','string','enum',JSON_ARRAY('production','development')),'app_key',JSON_OBJECT('type','string'),'break_glass_reason',JSON_OBJECT('type','string'))),
    JSON_OBJECT('auth_source','stored_hostinger_ssh_or_api_binding','inline_secret_allowed',false,'secrets_included',false),
    JSON_OBJECT('requires_capability_envelope_for_apply',true,'requires_break_glass_reason',true,'requires_post_restart_readback',true,'deploy_write_allowed',false,'secrets_included',false),
    'Admin export for governed Hostinger restart option. Break-glass recovery only; no deploy write authorized by restart.'
  )
ON DUPLICATE KEY UPDATE
  parent_action_key=VALUES(parent_action_key),
  endpoint_key=VALUES(endpoint_key),
  tool_name=VALUES(tool_name),
  scope_class=VALUES(scope_class),
  status=VALUES(status),
  import_policy_json=VALUES(import_policy_json),
  input_schema_json=VALUES(input_schema_json),
  auth_policy_json=VALUES(auth_policy_json),
  execution_policy_json=VALUES(execution_policy_json),
  notes=VALUES(notes),
  updated_at=CURRENT_TIMESTAMP;

INSERT INTO app_integration_tool_bindings (
  binding_id, app_key, tool_key, tool_surface, binding_role, credential_source,
  exposure_scope, status, notes
)
VALUES
  (
    'bind_tool_hostinger_remote_runtime_deploy_release',
    'hostinger',
    'remote_runtime_hostinger_deploy_release',
    'platform_endpoint_export',
    'state_changing',
    'tenant_connection',
    'admin',
    'active',
    'Binds Hostinger deploy-release recovery option to app integration. Execution remains capability-envelope, expected-SHA, feature-flag, and readback gated.'
  ),
  (
    'bind_tool_hostinger_ssh_restart_app',
    'hostinger',
    'hostinger_ssh_restart_app',
    'platform_endpoint_export',
    'state_changing',
    'tenant_connection',
    'admin',
    'active',
    'Binds Hostinger restart recovery option to app integration. Execution remains break-glass, capability-envelope, and readback gated.'
  )
ON DUPLICATE KEY UPDATE
  tool_key=VALUES(tool_key),
  tool_surface=VALUES(tool_surface),
  binding_role=VALUES(binding_role),
  credential_source=VALUES(credential_source),
  exposure_scope=VALUES(exposure_scope),
  status=VALUES(status),
  notes=VALUES(notes),
  updated_at=CURRENT_TIMESTAMP;

CREATE OR REPLACE VIEW v_hostinger_recovery_option_readiness AS
SELECT
  m.app_key,
  m.action_key,
  m.active_tool_exports,
  m.active_tool_bindings,
  m.bound_tool_keys,
  MAX(CASE WHEN e.tool_name='remote_runtime_hostinger_deploy_release' THEN e.status ELSE NULL END) AS deploy_export_status,
  MAX(CASE WHEN e.tool_name='hostinger_ssh_restart_app' THEN e.status ELSE NULL END) AS restart_export_status,
  MAX(CASE WHEN b.tool_key='remote_runtime_hostinger_deploy_release' THEN b.status ELSE NULL END) AS deploy_binding_status,
  MAX(CASE WHEN b.tool_key='hostinger_ssh_restart_app' THEN b.status ELSE NULL END) AS restart_binding_status,
  0 AS secrets_included
FROM v_app_integration_capability_map m
LEFT JOIN platform_endpoint_tool_exports e ON e.parent_action_key=m.action_key
LEFT JOIN app_integration_tool_bindings b ON b.app_key=m.app_key
WHERE m.app_key='hostinger' AND m.action_key='hostinger_api'
GROUP BY m.app_key, m.action_key, m.active_tool_exports, m.active_tool_bindings, m.bound_tool_keys;
