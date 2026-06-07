-- Sprint 67: DB-backed Hostinger SSH probe gate for stateless runtimes.
-- Allows the approved read-only SSH probe route to use a short-lived SQL gate
-- when process.env changes do not stick across web workers. This does not
-- enable deploy/restart/provider dispatch and does not store or return secrets.

INSERT INTO platform_runtime_config
(config_key, config_json, status, note)
VALUES
('remote_runtime_hostinger_ssh_probe_enabled',
 JSON_OBJECT(
   'enabled', false,
   'target_id', 'b49fe2ae-5974-11f1-9baf-8e76a7e1749f',
   'purpose', 'approval_gated_read_only_ssh_probe',
   'expires_at', NULL,
   'secrets_included', false,
   'notes', 'Set enabled=true with a short expires_at only during the same approved read-only Hostinger SSH probe cycle.'
 ),
 'active',
 'Short-lived DB-backed gate for Hostinger SSH probe execution in stateless runtimes. Default disabled.'
)
ON DUPLICATE KEY UPDATE
 config_json = JSON_SET(
   COALESCE(config_json, JSON_OBJECT()),
   '$.enabled', false,
   '$.target_id', 'b49fe2ae-5974-11f1-9baf-8e76a7e1749f',
   '$.purpose', 'approval_gated_read_only_ssh_probe',
   '$.expires_at', NULL,
   '$.secrets_included', false
 ),
 status='active',
 note=VALUES(note),
 updated_at=CURRENT_TIMESTAMP;

INSERT INTO execution_policies
(policy_group, policy_key, policy_value, active, execution_scope, affects_layer, blocking, notes)
VALUES
('remote_runtime_hostinger_deploy_governance','hostinger_ssh_probe_db_gate_guard',
 JSON_OBJECT(
   'rule','db_backed_probe_gate_may_replace_process_env_for_stateless_runtime_only',
   'config_key','remote_runtime_hostinger_ssh_probe_enabled',
   'default_enabled',false,
   'requires',JSON_ARRAY('explicit approval','short expires_at','target_id match','read-only ssh_probe only','bounded output','no_secret_response','feature flag reset/expiry after attempt'),
   'forbidden',JSON_ARRAY('deploy_release enablement','restart_app enablement','provider dispatch enablement','unbounded true flag','secret response','target activation without same-cycle probe success')
 ),
 'true','remote_runtime_hostinger_probe','hostingerSshDeployExecutor,platform_runtime_config,runtime_dispatch_certification_registry','true',
 'The Hostinger read-only SSH probe may use a short-lived SQL gate when process.env mutations do not persist across stateless workers. Deploy/restart/provider dispatch remain separate gates.'
)
ON DUPLICATE KEY UPDATE
 policy_value=VALUES(policy_value), active=VALUES(active), execution_scope=VALUES(execution_scope), affects_layer=VALUES(affects_layer), blocking=VALUES(blocking), notes=VALUES(notes), updated_at=CURRENT_TIMESTAMP;

UPDATE runtime_dispatch_certification_registry
SET certification_status='db_gate_registered_pending_deploy_and_probe_smoke',
    dispatch_allowed=1,
    apply_allowed=0,
    notes='Read-only Hostinger SSH probe supports env flag or short-lived DB gate remote_runtime_hostinger_ssh_probe_enabled. Actual probe remains approval gated; no deploy/restart/provider dispatch.',
    updated_at=CURRENT_TIMESTAMP
WHERE certification_key='hostinger_ssh_target_probe_v1';
