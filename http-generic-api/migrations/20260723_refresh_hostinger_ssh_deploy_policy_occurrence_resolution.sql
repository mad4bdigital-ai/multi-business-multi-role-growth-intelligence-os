-- Refresh the persisted lifecycle timestamp and evidence for execution-log
-- occurrence 33325 after deployment of the Hostinger SSH target-policy guard.
--
-- The previous lifecycle migration correctly targeted open states, but the
-- persisted row was already resolved with a resolved_at timestamp older than the
-- July 22 occurrence. Timestamp-gated alert merging therefore reopened it.
--
-- Safety contract:
-- - exact alert and source_record_id targeting
-- - only an already-resolved row with stale resolved_at can change
-- - internal lifecycle persistence only
-- - no provider call, external write/send, credential read, or secrets
-- - any later occurrence still reopens because its last_seen_at will exceed the
--   refreshed resolved_at timestamp

UPDATE operational_alerts
SET lifecycle_revision = lifecycle_revision + 1,
    verification_state = 'verified',
    evidence_type = 'runtime_policy_guard_and_execution_occurrence_readback',
    evidence_ref = 'execution-log://33325',
    evidence_json = JSON_SET(
      COALESCE(evidence_json, JSON_OBJECT()),
      '$.execution_log_id', 33325,
      '$.execution_trace_id', 'hostinger_ssh_deploy_0d736b52-a79b-446e-8794-198490a9b0b2',
      '$.execution_created_at', '2026-07-22T23:30:20.000Z',
      '$.failure_reason', 'ssh_deploy_failed',
      '$.target_id', 'b49fe2ae-5974-11f1-9baf-8e76a7e1749f',
      '$.root_fix', 'hostinger_ssh_deploy_target_policy_guard',
      '$.root_fix_merge_sha', '3507f4098ef56179fd35d732b8890983ec14924a',
      '$.blocked_before_credential_resolution', TRUE,
      '$.blocked_before_network_io', TRUE,
      '$.deployment_strategy', 'github_main_auto_deploy',
      '$.deployment_allowed', FALSE,
      '$.ssh_normal_updates_allowed', FALSE,
      '$.ssh_path_status', 'skipped_by_user',
      '$.ssh_break_glass_only', TRUE,
      '$.future_newer_occurrence_reopens', TRUE,
      '$.migration_provider_call_executed', FALSE,
      '$.migration_external_write_executed', FALSE,
      '$.migration_external_send_executed', FALSE,
      '$.credential_payload_read', FALSE,
      '$.secrets_included', FALSE
    ),
    lifecycle_actor = 'migration:20260723_refresh_hostinger_ssh_deploy_policy_occurrence_resolution',
    lifecycle_note = 'Refreshed after production deployment of the fail-closed Hostinger SSH target-policy guard.',
    resolved_at = CURRENT_TIMESTAMP,
    resolution_note = 'Execution-log occurrence 33325 is covered by the deployed target-policy guard. The persisted lifecycle timestamp now postdates the occurrence; a later occurrence will reopen automatically.',
    secrets_included = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE alert_id = 'c916daf6-32d9-46f1-ba95-2c718900f3f0'
  AND source_record_id = 'execution:060bda5fdc0941a2efa4c09f1c293e7d5bd0f2bfead4d8b1825208ff7026deeb'
  AND lifecycle_status = 'resolved'
  AND resolved_at < '2026-07-22 23:30:20';
