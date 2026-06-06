-- Sprint 67: Governed Hostinger SSH target probe and activation guard.
-- Registers a disabled admin tool row and the ssh_probe command. The probe route
-- is read-only, fixed-command, approval-gated, no-secret, and feature-flagged.

INSERT INTO remote_runtime_command_allowlists
(command_id, plugin_key, command_key, display_name, target_kind, command_template, input_schema_json, risk_class, requires_approval, is_consequential, output_policy, status, notes)
VALUES
(UUID(), 'remote_ssh_runtime', 'ssh_probe', 'SSH Target Probe', 'hosting_account', 'remote_runtime:ssh:ssh_probe',
 JSON_OBJECT(
   'type','object',
   'required',JSON_ARRAY('target_id','app_key','app_path','approval_reason'),
   'properties',JSON_OBJECT(
     'target_id',JSON_OBJECT('type','string'),
     'app_key',JSON_OBJECT('type','string','enum',JSON_ARRAY('auth.mad4b.com')),
     'app_path',JSON_OBJECT('type','string','pattern','^/home/[^/]+/domains/auth\\.mad4b\\.com/nodejs$'),
     'expected_commit_sha',JSON_OBJECT('type','string','pattern','^[0-9a-f]{40}$'),
     'dry_run',JSON_OBJECT('type','boolean','default',true),
     'activate_on_success',JSON_OBJECT('type','boolean','default',false),
     'approval_reason',JSON_OBJECT('type','string','minLength',20),
     'timeout_ms',JSON_OBJECT('type','integer','minimum',1000,'maximum',300000)
   ),
   'additionalProperties',false
 ),
 'high', 1, 0, 'bounded_text', 'active',
 'Approval-gated read-only Hostinger SSH target probe. Executes fixed status/git readback only, never deploys, restarts, writes files, or returns raw secrets.'
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
SET command_allowlist_json = JSON_ARRAY('status','ssh_probe','tail_logs','restart_app','deploy_release','rollback_release'),
    updated_by='207_sprint67_hostinger_ssh_target_probe',
    updated_at=CURRENT_TIMESTAMP
WHERE target_id='b49fe2ae-5974-11f1-9baf-8e76a7e1749f'
  AND provider_family='hostinger'
  AND connector_family='hostinger_ssh';

INSERT INTO admin_platform_endpoint_tools
(tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order)
VALUES
('remote_runtime_hostinger_ssh_probe',
 'Remote Runtime Hostinger SSH Probe',
 'Approval-gated read-only SSH probe for Hostinger targets. Defaults to dry_run=true. Actual probe requires REMOTE_RUNTIME_HOSTINGER_SSH_PROBE_ENABLED=true, approval_reason, path allowlist, bounded output, and never returns secrets. It may mark a target active only after same-cycle probe success when activate_on_success=true.',
 'POST',
 '/platform/remote-runtime/hosting/ssh-probe',
 NULL,
 '{"type":"object","required":["target_id","app_key","app_path"],"properties":{"target_id":{"type":"string"},"app_key":{"type":"string","enum":["auth.mad4b.com"]},"app_path":{"type":"string"},"expected_commit_sha":{"type":"string","pattern":"^[0-9a-f]{40}$"},"dry_run":{"type":"boolean","default":true},"activate_on_success":{"type":"boolean","default":false},"approval_reason":{"type":"string","minLength":20},"timeout_ms":{"type":"integer","minimum":1000,"maximum":300000}},"additionalProperties":false}',
 NULL,
 'admin,platform-plugins,remote-runtime,hostinger,ssh,probe,approval_required,read_only,disabled_until_deploy,no_secrets,bounded_output,no_freeform_shell,path_allowlist,activation_requires_probe_success',
 0,
 154
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
('remote_runtime_hostinger_deploy_governance','hostinger_ssh_target_probe_guard',
 JSON_OBJECT(
   'rule','hostinger_ssh_target_activation_requires_same_cycle_readonly_probe',
   'target_id','b49fe2ae-5974-11f1-9baf-8e76a7e1749f',
   'app_key','auth.mad4b.com',
   'allowed_paths',JSON_ARRAY('/home/*/domains/auth.mad4b.com/nodejs'),
   'requires',JSON_ARRAY('approval_reason','path_allowlist_match','fixed read-only command','bounded_output','no_secret_output','same_cycle_probe_success_before_active'),
   'forbidden',JSON_ARRAY('manual active status without probe evidence','freeform shell','secret response','unbounded logs','repo mutation','restart','deploy','provider dispatch enablement')
 ),
 'true','remote_runtime_hostinger_probe','remote_runtime_targets,remote_runtime_command_allowlists,admin_platform_endpoint_tools,hostinger_ssh_deploy_executor','true',
 'Hostinger SSH target can be marked active only after the governed read-only probe succeeds in the same cycle.'
)
ON DUPLICATE KEY UPDATE
 policy_value=VALUES(policy_value), active=VALUES(active), execution_scope=VALUES(execution_scope), affects_layer=VALUES(affects_layer), blocking=VALUES(blocking), notes=VALUES(notes), updated_at=CURRENT_TIMESTAMP;

INSERT INTO runtime_dispatch_certification_registry
(certification_key, surface_key, surface_family, tool_or_action_key, risk_class, certification_status, smoke_strategy, dispatch_allowed, apply_allowed, requires_resource_authority, requires_dry_run, requires_audit_evidence, requires_readback, notes)
VALUES
('hostinger_ssh_target_probe_v1','hostinger_ssh_target_probe','remote_runtime_hostinger_probe','remote_runtime_hostinger_ssh_probe','high','route_registered_pending_deploy_and_probe_smoke','dry-run then approved fixed read-only SSH probe; target activation only after same-cycle success; no deploy/restart/provider dispatch',0,0,1,1,1,1,'Tool row stays disabled until route is deployed and a route readback smoke passes. Actual probe requires feature flag and approval reason.')
ON DUPLICATE KEY UPDATE
 surface_key=VALUES(surface_key), surface_family=VALUES(surface_family), tool_or_action_key=VALUES(tool_or_action_key), risk_class=VALUES(risk_class), certification_status=VALUES(certification_status), smoke_strategy=VALUES(smoke_strategy), dispatch_allowed=VALUES(dispatch_allowed), apply_allowed=VALUES(apply_allowed), requires_resource_authority=VALUES(requires_resource_authority), requires_dry_run=VALUES(requires_dry_run), requires_audit_evidence=VALUES(requires_audit_evidence), requires_readback=VALUES(requires_readback), notes=VALUES(notes), updated_at=CURRENT_TIMESTAMP;
