-- Sprint 67: Async job timeout and stale-running recovery.
-- Prevents long-running queue jobs from remaining stuck in running state
-- after request/worker transport timeouts. No secrets are stored or returned.

INSERT INTO execution_policies
(policy_group, policy_key, policy_value, active, execution_scope, affects_layer, blocking, notes)
VALUES
('async_job_governance','async_job_stale_timeout_recovery_guard',
 JSON_OBJECT(
   'rule','async_jobs_must_have_bounded_execution_timeout_and_stale_recovery',
   'default_timeout_source','request_payload.timeout_ms|request_payload.timeout_seconds|MAX_TIMEOUT_SECONDS',
   'timeout_buffer_ms',15000,
   'applies_to',JSON_ARRAY('hostinger_ssh_target_probe','http_execute','site_migration','connected_execution_resume_action','tenant_ssh_cli_execute'),
   'requires',JSON_ARRAY('terminal failed status for stale running jobs','sanitized error_payload','no_secret_response','poll/status readback recovery','async writeback evidence'),
   'forbidden',JSON_ARRAY('indefinite running status','secret values in timeout errors','target activation without terminal success','provider dispatch after stale timeout')
 ),
 'true','jobs|queue_worker|async_execution|poll_read','jobRunner,executionAsync,jobUtils,routes/jobRoutes','true',
 'Async jobs must be bounded by a job-level timeout and stale running jobs must fail safely during status/result readback. This prevents Hostinger SSH probe jobs from remaining running after 524/transport interruptions.'
)
ON DUPLICATE KEY UPDATE
 policy_value=VALUES(policy_value), active=VALUES(active), execution_scope=VALUES(execution_scope), affects_layer=VALUES(affects_layer), blocking=VALUES(blocking), notes=VALUES(notes), updated_at=CURRENT_TIMESTAMP;

UPDATE runtime_dispatch_certification_registry
SET certification_status='async_job_timeout_recovery_registered_pending_deploy_and_stale_readback_smoke',
    dispatch_allowed=1,
    apply_allowed=0,
    notes='Hostinger read-only SSH probe queue worker is protected by job-level timeout and stale-running recovery. Existing stuck jobs should fail safely on status/result readback after deployment.',
    updated_at=CURRENT_TIMESTAMP
WHERE certification_key='hostinger_ssh_target_probe_v1';

INSERT INTO readiness_checks
(check_id, tenant_id, check_key, check_status, detail)
VALUES
(UUID(), 'e989a841-fce0-4ced-be76-463e8202a066', 'async-job-timeout-recovery-v1', 'pending',
 'Async job timeout recovery must fail stale running jobs safely with no secrets and keep Hostinger target activation blocked unless terminal probe success is observed.'
)
ON DUPLICATE KEY UPDATE
 check_status=VALUES(check_status),
 detail=VALUES(detail),
 checked_at=CURRENT_TIMESTAMP;
