-- Sprint 67: Hostinger runner-mode durable job submission.
-- Ensures Redis-backed job persistence completes before starting non-queue runners.
-- No secrets, deploy, restart, or provider dispatch are enabled.

INSERT INTO execution_policies
(policy_group, policy_key, policy_value, active, execution_scope, affects_layer, blocking, notes)
VALUES
('remote_runtime_hostinger_deploy_governance','hostinger_runner_mode_durable_submit_guard',
 JSON_OBJECT(
   'rule','runner_mode_jobs_must_be_persisted_before_runner_dispatch',
   'applies_to',JSON_ARRAY('detached_process','cron_worker','external_runner','queue_worker'),
   'requires',JSON_ARRAY('await jobRepository.set(job)','Redis job visible before detached_process spawn','idempotency write after durable job write','no inline secrets','no target activation without terminal success'),
   'forbidden',JSON_ARRAY('fire-and-forget jobRepository.set before detached runner','runner claim before Redis persistence','secret values in runner mode evidence','provider dispatch enablement')
 ),
 'true','remote_runtime_hostinger_probe|jobs','executionAsync,runtimeState,hostingerSshProbeRunnerModes,hostingerSshProbeDetachedRunner','true',
 'Hostinger runner-mode jobs must be durably persisted before runner dispatch so detached/cron/external runners can claim the job from Redis.'
)
ON DUPLICATE KEY UPDATE
 policy_value=VALUES(policy_value), active=VALUES(active), execution_scope=VALUES(execution_scope), affects_layer=VALUES(affects_layer), blocking=VALUES(blocking), notes=VALUES(notes), updated_at=CURRENT_TIMESTAMP;

UPDATE runtime_dispatch_certification_registry
SET certification_status='runner_modes_durable_submit_registered_pending_deploy_and_detached_probe_smoke',
    dispatch_allowed=1,
    apply_allowed=0,
    notes='Hostinger read-only SSH probe runner modes require durable Redis-backed job persistence before runner dispatch. Deploy/restart/provider dispatch remain disabled.',
    updated_at=CURRENT_TIMESTAMP
WHERE certification_key='hostinger_ssh_target_probe_v1';

INSERT INTO readiness_checks
(check_id, tenant_id, check_key, check_status, detail)
VALUES
(UUID(), 'e989a841-fce0-4ced-be76-463e8202a066', 'hostinger-runner-durable-submit-v1', 'pending',
 'Detached/cron/external Hostinger SSH probe runner modes must read the queued job from Redis after durable submission before any terminal probe result can be trusted.'
)
ON DUPLICATE KEY UPDATE
 check_status=VALUES(check_status),
 detail=VALUES(detail),
 checked_at=CURRENT_TIMESTAMP;
