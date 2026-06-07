-- Sprint 67: Hostinger SSH probe fast-fail timeout guard.
-- Prevents Hostinger SSH password probes from hanging beyond proxy/request limits.
-- No secrets are stored or returned and no deploy/restart/provider dispatch is enabled.

INSERT INTO execution_policies
(policy_group, policy_key, policy_value, active, execution_scope, affects_layer, blocking, notes)
VALUES
('remote_runtime_hostinger_deploy_governance','hostinger_ssh_probe_fast_timeout_guard',
 JSON_OBJECT(
   'rule','hostinger_ssh_probe_must_fail_fast_and_kill_subprocess_tree',
   'default_probe_timeout_ms',45000,
   'max_probe_timeout_ms',75000,
   'ssh_connect_timeout_seconds',10,
   'ssh_connection_attempts',1,
   'ssh_server_alive_interval_seconds',5,
   'ssh_server_alive_count_max',1,
   'process_timeout_wrapper','coreutils_timeout_no_shell',
   'process_group_kill',true,
   'requires',JSON_ARRAY('argv-only ssh invocation','shell:false','timeout command wrapper','process group kill fallback','NumberOfPasswordPrompts=1 for password auth','password via fd 3 only','bounded sanitized output','no_secret_response'),
   'forbidden',JSON_ARRAY('unbounded SSH probes','password in argv','SSHPASS env','interactive prompts','freeform shell','target activation without terminal probe success')
 ),
 'true','remote_runtime_hostinger_probe','hostingerSshDeployExecutor,jobRunner,platform_runtime_config','true',
 'Hostinger SSH probes must fail fast below proxy/request limits and must kill SSH/sshpass subprocess groups on timeout so async jobs reach terminal readback.'
)
ON DUPLICATE KEY UPDATE
 policy_value=VALUES(policy_value), active=VALUES(active), execution_scope=VALUES(execution_scope), affects_layer=VALUES(affects_layer), blocking=VALUES(blocking), notes=VALUES(notes), updated_at=CURRENT_TIMESTAMP;

UPDATE runtime_dispatch_certification_registry
SET certification_status='fast_timeout_registered_pending_deploy_and_probe_smoke',
    dispatch_allowed=1,
    apply_allowed=0,
    notes='Hostinger read-only SSH probe is guarded by short SSH timeouts, coreutils timeout wrapper, and process-group kill fallback. Deploy/restart/provider dispatch remain disabled.',
    updated_at=CURRENT_TIMESTAMP
WHERE certification_key='hostinger_ssh_target_probe_v1';

INSERT INTO readiness_checks
(check_id, tenant_id, check_key, check_status, detail)
VALUES
(UUID(), 'e989a841-fce0-4ced-be76-463e8202a066', 'hostinger-ssh-probe-fast-timeout-v1', 'pending',
 'Hostinger SSH probe must fail fast with sanitized timeout evidence or succeed with same-cycle proof; target activation remains blocked unless terminal probe success is observed.'
)
ON DUPLICATE KEY UPDATE
 check_status=VALUES(check_status),
 detail=VALUES(detail),
 checked_at=CURRENT_TIMESTAMP;
