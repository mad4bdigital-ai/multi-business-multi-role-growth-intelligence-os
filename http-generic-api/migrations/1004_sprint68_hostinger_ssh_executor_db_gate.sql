-- Sprint 68: DB-backed Hostinger SSH deploy executor gate for stateless runtimes.
-- The gate defaults disabled and may be enabled only for one approved target and
-- a short expiry window after same-cycle dry-run, capability-envelope approval,
-- exact commit SHA selection, and before mandatory post-deploy readback.
-- No provider calls. No credential payload reads. No raw secrets.
-- No external sends. No external writes are performed by this migration.
-- secrets_included=false

INSERT INTO platform_runtime_config
(config_key, config_json, status, note)
VALUES
('remote_runtime_hostinger_ssh_executor_enabled',
 JSON_OBJECT(
   'enabled', false,
   'target_id', 'b49fe2ae-5974-11f1-9baf-8e76a7e1749f',
   'purpose', 'approval_gated_hostinger_ssh_deploy_release',
   'expires_at', NULL,
   'capability_envelope_required', true,
   'same_cycle_dry_run_required', true,
   'expected_commit_sha_required', true,
   'post_deploy_readback_required', true,
   'secrets_included', false,
   'notes', 'Set enabled=true with a short expires_at only during the same approved Hostinger deploy cycle; reset or expire immediately after the attempt.'
 ),
 'active',
 'Short-lived DB-backed gate for Hostinger SSH deploy execution in stateless runtimes. Default disabled.'
)
ON DUPLICATE KEY UPDATE
 config_json = JSON_SET(
   COALESCE(config_json, JSON_OBJECT()),
   '$.enabled', false,
   '$.target_id', 'b49fe2ae-5974-11f1-9baf-8e76a7e1749f',
   '$.purpose', 'approval_gated_hostinger_ssh_deploy_release',
   '$.expires_at', NULL,
   '$.capability_envelope_required', true,
   '$.same_cycle_dry_run_required', true,
   '$.expected_commit_sha_required', true,
   '$.post_deploy_readback_required', true,
   '$.secrets_included', false
 ),
 status='active',
 note=VALUES(note),
 updated_at=CURRENT_TIMESTAMP;

INSERT INTO execution_policies
(policy_group, policy_key, policy_value, active, execution_scope, affects_layer, blocking, notes)
VALUES
('remote_runtime_hostinger_deploy_governance','hostinger_ssh_executor_db_gate_guard',
 JSON_OBJECT(
   'rule','short_lived_db_gate_may_replace_process_env_for_stateless_deploy_workers_only',
   'config_key','remote_runtime_hostinger_ssh_executor_enabled',
   'legacy_env_key','REMOTE_RUNTIME_HOSTINGER_SSH_EXECUTOR_ENABLED',
   'default_enabled',false,
   'requires',JSON_ARRAY('explicit approval','ready_for_dispatch capability envelope','same-cycle dry-run','exact expected commit SHA','target_id match','short expires_at','path allowlist','bounded output','post-deploy readback','gate reset or expiry after attempt','no_secret_response'),
   'forbidden',JSON_ARRAY('unbounded true gate','cross-target use','missing expiry','mutable branch-only deploy','inline credential','freeform shell','secret response','success claim before readback')
 ),
 'true','remote_runtime_hostinger_deploy','hostingerSshDeployExecutor,platform_runtime_config,capability_resolution_envelope_ledger,runtime_dispatch_certification_registry','true',
 'Hostinger deploy execution may use an environment flag or a short-lived target-bound SQL gate. Capability envelope, exact SHA, path, audit, bounded output and readback gates remain mandatory.'
)
ON DUPLICATE KEY UPDATE
 policy_value=VALUES(policy_value), active=VALUES(active), execution_scope=VALUES(execution_scope), affects_layer=VALUES(affects_layer), blocking=VALUES(blocking), notes=VALUES(notes), updated_at=CURRENT_TIMESTAMP;

UPDATE platform_runtime_config
SET config_json = JSON_SET(
      config_json,
      '$.feature_flag_still_required', 'REMOTE_RUNTIME_HOSTINGER_SSH_EXECUTOR_ENABLED or remote_runtime_hostinger_ssh_executor_enabled',
      '$.feature_gate_env', 'REMOTE_RUNTIME_HOSTINGER_SSH_EXECUTOR_ENABLED',
      '$.feature_gate_db', 'remote_runtime_hostinger_ssh_executor_enabled',
      '$.db_gate_requires_target_and_expiry', true
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE config_key='hostinger_deploy_capability_envelope_requirement_v1';

UPDATE capability_apply_authorization_policy_registry
SET policy_json = JSON_SET(
      policy_json,
      '$.feature_flag_required', 'REMOTE_RUNTIME_HOSTINGER_SSH_EXECUTOR_ENABLED or remote_runtime_hostinger_ssh_executor_enabled',
      '$.feature_gate_env', 'REMOTE_RUNTIME_HOSTINGER_SSH_EXECUTOR_ENABLED',
      '$.feature_gate_db', 'remote_runtime_hostinger_ssh_executor_enabled',
      '$.db_gate_requires_target_and_expiry', true
    ),
    notes = 'Apply policy for governed Hostinger deploy release. Actual execution accepts the legacy process ENV gate or the short-lived target-bound SQL gate; all envelope, dry-run, SHA, audit and readback requirements remain mandatory.',
    updated_at = CURRENT_TIMESTAMP
WHERE policy_key='hostinger_deploy_release_apply_policy_v1';

UPDATE runtime_dispatch_certification_registry
SET notes = CONCAT(
      'Dry-run certification only. Actual deploy requires capability envelope, exact SHA, path allowlist, audit and readback plus either ',
      'REMOTE_RUNTIME_HOSTINGER_SSH_EXECUTOR_ENABLED=true or a short-lived target-bound remote_runtime_hostinger_ssh_executor_enabled SQL gate.'
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE certification_key IN ('remote_runtime_hostinger_deploy_release','remote_runtime_hostinger_deploy_release_v1');
