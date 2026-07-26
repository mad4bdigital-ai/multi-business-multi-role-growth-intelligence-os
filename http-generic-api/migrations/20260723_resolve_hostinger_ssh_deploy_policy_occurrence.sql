-- Resolve the Hostinger SSH deploy failure occurrence recorded after the target
-- had already moved to GitHub main auto-deploy. The accompanying runtime change
-- now blocks non-dry-run SSH deploy before credential resolution or network I/O
-- whenever target metadata disables deployment, disables normal SSH updates,
-- marks the SSH path skipped, or selects github_main_auto_deploy.
--
-- Safety contract:
-- - exact alert and execution-log occurrence targeting
-- - lifecycle-only internal persistence
-- - no provider call, external write, external send, credential read, or secrets
-- - any later execution occurrence will reopen through timestamp-gated lifecycle
--   merging because its last_seen_at will be newer than this resolved_at value

UPDATE operational_alerts
SET lifecycle_status = 'resolved',
    lifecycle_revision = lifecycle_revision + 1,
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
    lifecycle_actor = 'migration:20260723_resolve_hostinger_ssh_deploy_policy_occurrence',
    lifecycle_note = 'Resolved after deploying a fail-closed target metadata guard that blocks non-dry-run Hostinger SSH deploy before credentials or network access.',
    resolved_at = CURRENT_TIMESTAMP,
    resolution_note = 'The July 22 SSH deploy attempt is superseded by GitHub main auto-deploy and can no longer reach the SSH executor under the current target policy. A later occurrence will reopen automatically.',
    secrets_included = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE alert_id = 'c916daf6-32d9-46f1-ba95-2c718900f3f0'
  AND source_record_id = 'execution:060bda5fdc0941a2efa4c09f1c293e7d5bd0f2bfead4d8b1825208ff7026deeb'
  AND lifecycle_status IN ('open', 'acknowledged', 'investigating');
