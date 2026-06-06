-- Sprint 67: Hostinger SSH password auth support.
-- Adds password-auth mode to the governed Hostinger SSH probe/deploy contract.
-- Password values must be collected through credential intake and must not be
-- returned, placed in argv, or placed in process environment variables.

UPDATE remote_runtime_command_allowlists
SET input_schema_json = JSON_SET(
      COALESCE(input_schema_json, JSON_OBJECT('type','object','properties',JSON_OBJECT())),
      '$.properties.ssh_auth_mode', JSON_OBJECT('type','string','enum',JSON_ARRAY('password','private_key'),'default','password'),
      '$.properties.ssh_password', JSON_OBJECT('type','string','writeOnly',true,'description','Stored via credential intake only; never accepted inline for execution.')
    ),
    notes = CONCAT(COALESCE(notes,''), ' Supports ssh_auth_mode=password through governed ssh_password credential intake; no inline password execution.'),
    updated_at = CURRENT_TIMESTAMP
WHERE plugin_key='remote_ssh_runtime'
  AND command_key IN ('ssh_probe','deploy_release');

UPDATE admin_platform_endpoint_tools
SET input_schema = JSON_SET(
      COALESCE(CAST(input_schema AS JSON), JSON_OBJECT('type','object','properties',JSON_OBJECT())),
      '$.properties.ssh_auth_mode', JSON_OBJECT('type','string','enum',JSON_ARRAY('password','private_key'),'default','password')
    ),
    description = CONCAT(COALESCE(description,''), ' Supports ssh_auth_mode=password through stored ssh_password credential intake; no inline password is accepted.'),
    updated_at = CURRENT_TIMESTAMP
WHERE tool_key IN ('remote_runtime_hostinger_ssh_probe','remote_runtime_hostinger_deploy_release');

INSERT INTO execution_policies
(policy_group, policy_key, policy_value, active, execution_scope, affects_layer, blocking, notes)
VALUES
('remote_runtime_hostinger_deploy_governance','hostinger_ssh_password_auth_guard',
 JSON_OBJECT(
   'rule','hostinger_ssh_password_auth_must_use_governed_intake_and_fd_delivery',
   'allowed_auth_modes',JSON_ARRAY('password','private_key'),
   'default_auth_mode','password',
   'requires',JSON_ARRAY('ssh_password from credential resolver','credential intake for missing password','approval_reason','feature_flag','path_allowlist','bounded_output','no_secret_response','sshpass_fd_delivery'),
   'forbidden',JSON_ARRAY('inline password request body','password in argv','SSHPASS environment variable','interactive prompt','freeform shell','provider dispatch enablement','target activation without same-cycle probe success')
 ),
 'true','remote_runtime_hostinger_probe|remote_runtime_hostinger_deploy','hostingerSshDeployExecutor,credentialIntakeEnforcement,remote_runtime_command_allowlists,credential_intake_sessions','true',
 'Hostinger password-based SSH is supported only through governed credential intake and sshpass file-descriptor delivery; no raw secret output.'
)
ON DUPLICATE KEY UPDATE
 policy_value=VALUES(policy_value), active=VALUES(active), execution_scope=VALUES(execution_scope), affects_layer=VALUES(affects_layer), blocking=VALUES(blocking), notes=VALUES(notes), updated_at=CURRENT_TIMESTAMP;

UPDATE runtime_dispatch_certification_registry
SET certification_status='password_auth_route_registered_pending_deploy_and_smoke',
    smoke_strategy='dry-run then approved fixed read-only SSH probe using ssh_auth_mode=password; password stored via credential intake; no argv/env secret exposure; target activation only after same-cycle success',
    dispatch_allowed=1,
    apply_allowed=0,
    requires_resource_authority=1,
    requires_dry_run=1,
    requires_audit_evidence=1,
    requires_readback=1,
    notes='Password auth support added to the guarded Hostinger SSH probe/deploy route. Actual execution remains feature-flag and approval gated; deploy remains separately gated.',
    updated_at=CURRENT_TIMESTAMP
WHERE certification_key='hostinger_ssh_target_probe_v1';

INSERT INTO readiness_checks
(check_id, tenant_id, check_key, check_status, detail)
VALUES
(UUID(), 'e989a841-fce0-4ced-be76-463e8202a066', 'hostinger-ssh-password-auth-v1', 'pending',
 'Hostinger SSH password auth must use credential intake for ssh_password, sshpass -d file descriptor delivery, no SSHPASS env, no argv password, no secret response, and no target activation until same-cycle read-only probe success.'
)
ON DUPLICATE KEY UPDATE
 check_status=VALUES(check_status),
 detail=VALUES(detail),
 checked_at=CURRENT_TIMESTAMP;
