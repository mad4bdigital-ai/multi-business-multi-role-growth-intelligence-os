-- Sprint 67: Hostinger SSH probe runner modes.
-- Adds explicit execution modes for queue_worker, detached_process, cron_worker,
-- and external_runner. The web request remains submit/status-only for non-queue modes.
-- No deploy/restart/provider dispatch is enabled and no secrets are returned.

UPDATE admin_platform_endpoint_tools
SET input_schema = JSON_SET(
      COALESCE(input_schema, JSON_OBJECT('type','object','properties',JSON_OBJECT())),
      '$.properties.runner_mode', JSON_OBJECT(
        'type','string',
        'enum',JSON_ARRAY('queue_worker','detached_process','cron_worker','external_runner'),
        'default','queue_worker',
        'description','Hostinger SSH probe execution mode. queue_worker uses BullMQ; detached_process spawns a one-shot Node runner; cron_worker waits for a scheduled runner; external_runner waits for a dedicated runner.'
      )
    ),
    description='Queue-backed or runner-mode read-only Hostinger SSH probe. runner_mode supports queue_worker, detached_process, cron_worker, and external_runner. Non-queue modes keep HTTP submit/status separate from SSH execution. Requires DB gate or env flag at runner execution time. No deploy, no restart, no provider dispatch, and no secrets returned.',
    updated_at=CURRENT_TIMESTAMP
WHERE tool_key='remote_runtime_hostinger_ssh_probe_async';

INSERT INTO execution_policies
(policy_group, policy_key, policy_value, active, execution_scope, affects_layer, blocking, notes)
VALUES
('remote_runtime_hostinger_deploy_governance','hostinger_ssh_probe_runner_mode_guard',
 JSON_OBJECT(
   'rule','hostinger_ssh_probe_must_use_explicit_runner_mode',
   'modes',JSON_OBJECT(
     'queue_worker','Existing BullMQ worker path for short jobs.',
     'detached_process','One-shot Node process reads Redis job and writes terminal result outside Cloudflare request path.',
     'cron_worker','Scheduled runner scans queued hostinger_ssh_target_probe jobs with runner_mode=cron_worker.',
     'external_runner','Dedicated local/VPS runner claims a job and writes result; web app is submit/status only.'
   ),
   'requires',JSON_ARRAY('explicit runner_mode','approval_reason','short-lived DB gate at execution time','stored credentials only','bounded sanitized output','no_secret_response'),
   'forbidden',JSON_ARRAY('inline SSH password','deploy_release execution','restart_app execution','provider dispatch enablement','freeform shell','target activation without terminal probe success')
 ),
 'true','remote_runtime_hostinger_probe','executionAsync,hostingerSshDeployExecutor,hostingerSshProbeRunnerModes,hostingerSshProbeDetachedRunner,admin_platform_endpoint_tools','true',
 'Hostinger SSH probe supports four explicit runner modes so web requests do not have to own long SSH execution. All modes remain read-only and gated.'
)
ON DUPLICATE KEY UPDATE
 policy_value=VALUES(policy_value), active=VALUES(active), execution_scope=VALUES(execution_scope), affects_layer=VALUES(affects_layer), blocking=VALUES(blocking), notes=VALUES(notes), updated_at=CURRENT_TIMESTAMP;

UPDATE runtime_dispatch_certification_registry
SET certification_status='runner_modes_registered_pending_deploy_and_mode_smoke',
    dispatch_allowed=1,
    apply_allowed=0,
    notes='Hostinger read-only SSH probe supports runner modes queue_worker, detached_process, cron_worker, and external_runner. Deploy/restart/provider dispatch remain disabled.',
    updated_at=CURRENT_TIMESTAMP
WHERE certification_key='hostinger_ssh_target_probe_v1';

INSERT INTO readiness_checks
(check_id, tenant_id, check_key, check_status, detail)
VALUES
(UUID(), 'e989a841-fce0-4ced-be76-463e8202a066', 'hostinger-ssh-probe-runner-modes-v1', 'pending',
 'Hostinger SSH probe runner modes must submit without secrets, keep DB gate scoped/short-lived, and produce terminal job result only through a governed runner mode.'
)
ON DUPLICATE KEY UPDATE
 check_status=VALUES(check_status),
 detail=VALUES(detail),
 checked_at=CURRENT_TIMESTAMP;
