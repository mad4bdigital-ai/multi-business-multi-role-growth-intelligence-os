-- Sprint 67: Queue-backed Hostinger SSH probe worker.
-- The synchronous read-only probe can fail with 503 on long SSH attempts.
-- This migration registers a /jobs-backed admin tool that returns job_id/status_url
-- immediately and executes the same guarded Hostinger SSH probe in the worker.
-- No deploy/restart/provider dispatch is enabled here and no secrets are returned.

INSERT INTO admin_platform_endpoint_tools
(tool_key, display_name, description, http_method, http_path, path_param_keys, input_schema, fixed_body, tags, is_enabled, sort_order)
VALUES
('remote_runtime_hostinger_ssh_probe_async',
 'Hostinger SSH Probe Async',
 'Queue-backed read-only Hostinger SSH probe. Returns job_id/status_url/result_url immediately; worker executes hostinger_ssh_target_probe with stored credentials only. Requires DB gate or env flag at worker execution time. No deploy, no restart, no provider dispatch, and no secrets returned.',
 'POST',
 '/jobs',
 JSON_ARRAY(),
 JSON_OBJECT(
   'type','object',
   'required',JSON_ARRAY('target_id','app_key','app_path','approval_reason'),
   'properties',JSON_OBJECT(
     'target_id',JSON_OBJECT('type','string'),
     'app_key',JSON_OBJECT('type','string','enum',JSON_ARRAY('auth.mad4b.com')),
     'app_path',JSON_OBJECT('type','string'),
     'expected_commit_sha',JSON_OBJECT('type','string','pattern','^[0-9a-f]{40}$'),
     'ssh_auth_mode',JSON_OBJECT('type','string','enum',JSON_ARRAY('password','private_key'),'default','password'),
     'activate_on_success',JSON_OBJECT('type','boolean','default',false),
     'approval_reason',JSON_OBJECT('type','string','minLength',20),
     'timeout_ms',JSON_OBJECT('type','integer','minimum',1000,'maximum',300000),
     'max_attempts',JSON_OBJECT('type','integer','minimum',1,'maximum',3,'default',1),
     'idempotency_key',JSON_OBJECT('type','string'),
     'webhook_url',JSON_OBJECT('type','string','format','uri')
   ),
   'additionalProperties',false
 ),
 JSON_OBJECT('job_type','hostinger_ssh_target_probe','max_attempts',1),
 'remote-runtime,hostinger,ssh,queue,read-only',
 1,
 7548)
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
('remote_runtime_hostinger_deploy_governance','hostinger_ssh_probe_queue_worker_guard',
 JSON_OBJECT(
   'rule','hostinger_ssh_probe_long_running_attempts_must_use_queue_worker_when_sync_route_returns_503',
   'job_type','hostinger_ssh_target_probe',
   'tool_key','remote_runtime_hostinger_ssh_probe_async',
   'requires',JSON_ARRAY('explicit approval_reason','short-lived DB gate or env flag at worker execution time','stored credentials only','bounded output','job status/result polling','no_secret_response'),
   'forbidden',JSON_ARRAY('inline SSH password','deploy_release execution','restart_app execution','provider dispatch enablement','freeform shell','target activation without same-cycle probe success')
 ),
 'true','remote_runtime_hostinger_probe','jobRunner,executionAsync,hostingerSshDeployExecutor,admin_platform_endpoint_tools,platform_runtime_config','true',
 'Long-running Hostinger read-only SSH probes should be submitted as queue jobs to avoid request 503s. Worker uses the same guarded executor and never returns raw secrets.'
)
ON DUPLICATE KEY UPDATE
 policy_value=VALUES(policy_value), active=VALUES(active), execution_scope=VALUES(execution_scope), affects_layer=VALUES(affects_layer), blocking=VALUES(blocking), notes=VALUES(notes), updated_at=CURRENT_TIMESTAMP;

UPDATE runtime_dispatch_certification_registry
SET certification_status='queue_worker_registered_pending_deploy_and_async_probe_smoke',
    dispatch_allowed=1,
    apply_allowed=0,
    notes='Hostinger read-only SSH probe supports synchronous route and queued job route remote_runtime_hostinger_ssh_probe_async. Queue job returns job_id/status_url/result_url and executes the same guarded executor. Deploy/restart/provider dispatch remain disabled.',
    updated_at=CURRENT_TIMESTAMP
WHERE certification_key='hostinger_ssh_target_probe_v1';
