-- Sprint 67: Governed Hostinger SSH deploy executor guard.
-- Registers a disabled admin tool row and activates the deploy_release command
-- catalog entry for dry-run planning. The execution route remains additionally
-- protected by REMOTE_RUNTIME_HOSTINGER_SSH_EXECUTOR_ENABLED and approval input.

INSERT INTO remote_runtime_command_allowlists
(command_id, plugin_key, command_key, display_name, target_kind, command_template, input_schema_json, risk_class, requires_approval, is_consequential, output_policy, status, notes)
VALUES
(UUID(), 'remote_ssh_runtime', 'deploy_release', 'Deploy Release', 'hosting_account', 'remote_runtime:ssh:deploy_release',
 JSON_OBJECT(
   'type','object',
   'required',JSON_ARRAY('target_id','app_key','app_path','branch','expected_commit_sha','approval_reason'),
   'properties',JSON_OBJECT(
     'target_id',JSON_OBJECT('type','string'),
     'app_key',JSON_OBJECT('type','string','enum',JSON_ARRAY('auth.mad4b.com')),
     'app_path',JSON_OBJECT('type','string','pattern','^/home/[^/]+/domains/auth\\.mad4b\\.com/nodejs$'),
     'branch',JSON_OBJECT('type','string','enum',JSON_ARRAY('main')),
     'expected_commit_sha',JSON_OBJECT('type','string','pattern','^[0-9a-f]{40}$'),
     'dry_run',JSON_OBJECT('type','boolean','default',true),
     'force_clean',JSON_OBJECT('type','boolean','default',false),
     'restart',JSON_OBJECT('type','boolean','default',true),
     'approval_reason',JSON_OBJECT('type','string','minLength',20),
     'timeout_ms',JSON_OBJECT('type','integer','minimum',1000,'maximum',300000)
   ),
   'additionalProperties',false
 ),
 'high', 1, 1, 'bounded_text', 'active',
 'Approval-gated Hostinger SSH deploy release command. Executor uses fixed git checkout to an expected main commit, bounded output, no raw secret responses, and no freeform shell.'
)
ON DUPLICATE KEY UPDATE
 display_name=VALUES(display_name),
 target_kind=VALUES(target_kind),
 command_template=VALUES(command_template),
 input_schema_json=VALUES(input_schema_json),
 risk_class=VALUES(risk_class),
 requires_approval=VALUES(requires_approval),
 is_consequential=VALUES(is_consequential),
 output_policy=VALUES(output_policy),
 status=VALUES(status),
 notes=VALUES(notes),
 updated_at=CURRENT_TIMESTAMP;

UPDATE remote_runtime_targets
SET path_allowlist_json = JSON_ARRAY('/home/*/domains/auth.mad4b.com','/home/*/domains/auth.mad4b.com/nodejs','/home/*/domains/connector.mad4b.com','/home/*/domains/api.mad4b.com'),
    command_allowlist_json = JSON_ARRAY('status','tail_logs','restart_app','deploy_release','rollback_release'),
    updated_by='206_sprint67_hostinger_ssh_deploy_executor',
    updated_at=CURRENT_TIMESTAMP
WHERE target_id='b49fe2ae-5974-11f1-9baf-8e76a7e1749f'
  AND provider_family='hostinger'
  AND connector_family='hostinger_ssh';

INSERT INTO admin_platform_endpoint_tools
(tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order)
VALUES
('remote_runtime_hostinger_deploy_release',
 'Remote Runtime Hostinger Deploy Release',
 'Approval-gated production deploy for Hostinger SSH targets. Defaults to dry_run=true. Actual execution requires REMOTE_RUNTIME_HOSTINGER_SSH_EXECUTOR_ENABLED=true, approval_reason, path allowlist, expected main commit SHA, bounded output, and never returns secrets.',
 'POST',
 '/platform/remote-runtime/hosting/deploy-release',
 NULL,
 '{"type":"object","required":["target_id","app_key","app_path","branch","expected_commit_sha"],"properties":{"target_id":{"type":"string"},"app_key":{"type":"string","enum":["auth.mad4b.com"]},"app_path":{"type":"string"},"branch":{"type":"string","enum":["main"]},"expected_commit_sha":{"type":"string","pattern":"^[0-9a-f]{40}$"},"dry_run":{"type":"boolean","default":true},"force_clean":{"type":"boolean","default":false},"restart":{"type":"boolean","default":true},"approval_reason":{"type":"string","minLength":20},"timeout_ms":{"type":"integer","minimum":1000,"maximum":300000}},"additionalProperties":false}',
 NULL,
 'admin,platform-plugins,remote-runtime,hostinger,ssh,deploy,approval_required,state_changing,disabled_until_deploy,no_secrets,bounded_output,no_freeform_shell,expected_sha_required,path_allowlist',
 0,
 153
)
ON DUPLICATE KEY UPDATE
 display_name=VALUES(display_name),
 description=VALUES(description),
 http_method=VALUES(http_method),
 http_path=VALUES(http_path),
 path_param_keys=VALUES(path_param_keys),
 input_schema=VALUES(input_schema),
 fixed_body=VALUES(fixed_body),
 tags=VALUES(tags),
 is_enabled=VALUES(is_enabled),
 sort_order=VALUES(sort_order),
 updated_at=CURRENT_TIMESTAMP;

INSERT INTO execution_policies
(policy_group, policy_key, policy_value, active, execution_scope, affects_layer, blocking, notes)
VALUES
('remote_runtime_hostinger_deploy_governance','hostinger_ssh_deploy_release_guard',
 JSON_OBJECT(
   'rule','hostinger_ssh_deploy_requires_expected_main_sha_approval_and_no_secret_output',
   'target_id','b49fe2ae-5974-11f1-9baf-8e76a7e1749f',
   'app_key','auth.mad4b.com',
   'allowed_paths',JSON_ARRAY('/home/*/domains/auth.mad4b.com/nodejs'),
   'allowed_branch','main',
   'requires',JSON_ARRAY('expected_commit_sha','approval_reason','path_allowlist_match','bounded_output','same_cycle_health_readback'),
   'forbidden',JSON_ARRAY('freeform shell','secret response','unbounded logs','deploy without expected sha','provider dispatch enablement')
 ),
 'true','remote_runtime_hostinger_deploy','remote_runtime_targets,remote_runtime_command_allowlists,admin_platform_endpoint_tools,hostinger_ssh_deploy_executor','true',
 'Hostinger SSH deploy can only run through the governed executor with expected SHA, approval, no secret output, bounded logs, and health readback.'
)
ON DUPLICATE KEY UPDATE
 policy_value=VALUES(policy_value), active=VALUES(active), execution_scope=VALUES(execution_scope), affects_layer=VALUES(affects_layer), blocking=VALUES(blocking), notes=VALUES(notes), updated_at=CURRENT_TIMESTAMP;

INSERT INTO runtime_dispatch_certification_registry
(certification_key, surface_key, surface_family, tool_or_action_key, risk_class, certification_status, smoke_strategy, dispatch_allowed, apply_allowed, requires_resource_authority, requires_dry_run, requires_audit_evidence, requires_readback, notes)
VALUES
('hostinger_ssh_deploy_release_v1','hostinger_ssh_deploy_release','remote_runtime_hostinger_deploy','remote_runtime_hostinger_deploy_release','high','route_registered_pending_deploy_and_smoke','dry-run then approved deploy to expected main SHA, bounded log readback, /health and OpenClaude health route readback',0,0,1,1,1,1,'Tool row stays disabled until this route is deployed and a dry-run/readback smoke passes. Provider dispatch remains disabled.')
ON DUPLICATE KEY UPDATE
 surface_key=VALUES(surface_key), surface_family=VALUES(surface_family), tool_or_action_key=VALUES(tool_or_action_key), risk_class=VALUES(risk_class), certification_status=VALUES(certification_status), smoke_strategy=VALUES(smoke_strategy), dispatch_allowed=VALUES(dispatch_allowed), apply_allowed=VALUES(apply_allowed), requires_resource_authority=VALUES(requires_resource_authority), requires_dry_run=VALUES(requires_dry_run), requires_audit_evidence=VALUES(requires_audit_evidence), requires_readback=VALUES(requires_readback), notes=VALUES(notes), updated_at=CURRENT_TIMESTAMP;
