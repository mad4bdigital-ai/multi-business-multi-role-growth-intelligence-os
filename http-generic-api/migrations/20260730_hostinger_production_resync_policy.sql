-- Hostinger Production resynchronization policy authority.
-- Additive/idempotent SQL registry alignment only. This migration does not execute a deployment.
-- no_provider_call=true
-- no_credential_payload_read=true
-- no_raw_secrets=true
-- no_external_send=true
-- no_external_write=true
-- no_deploy_execution=true
-- no_restart_execution=true
-- no_feature_flag_change=true
-- no_scheduler_change=true
-- secrets_included=false

SET @repository_main_moved_coordination_type := (
  SELECT COLUMN_TYPE
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'repository_main_moved_trigger_events'
    AND COLUMN_NAME = 'coordination_status'
  LIMIT 1
);

SET @repository_main_moved_coordination_sql := CASE
  WHEN @repository_main_moved_coordination_type IS NULL THEN
    'SELECT ''repository_main_moved_trigger_events_missing'' AS migration_status'
  WHEN LOCATE('''production_sync_required''', @repository_main_moved_coordination_type) > 0 THEN
    'SELECT ''coordination_status_already_aligned'' AS migration_status'
  ELSE
    'ALTER TABLE `repository_main_moved_trigger_events` MODIFY COLUMN `coordination_status` ENUM(''received'',''verifying'',''evaluated'',''production_sync_required'',''approval_required'',''no_action'',''blocked'',''failed'',''superseded'') NOT NULL DEFAULT ''received'''
END;

PREPARE repository_main_moved_coordination_stmt FROM @repository_main_moved_coordination_sql;
EXECUTE repository_main_moved_coordination_stmt;
DEALLOCATE PREPARE repository_main_moved_coordination_stmt;

UPDATE platform_outbox_event_types
SET description = 'Internal metadata-only event emitted when the allowlisted repository main branch moves. The coordinator requires a governed latest-main to Production synchronization plan, fresh Hostinger build, exact Production merge SHA manifest readback, and healthy same-cycle runtime evidence before readiness. It grants no execution authority.',
    updated_at = CURRENT_TIMESTAMP(6)
WHERE event_type = 'repository.main_moved';

UPDATE admin_platform_endpoint_tools
SET description = 'Ingest one internal allowlisted main-branch movement event, run runtime verification, and create or deduplicate a mandatory latest-main to Production synchronization plan. Stops before PR mutation, merge, Hostinger build, deployment, restart, migration apply, provider action, or external write.',
    tags = 'release_intelligence,repository_event,main_source_branch,production_deployment_branch,production_sync_required,fresh_hostinger_build,exact_sha_readback,internal_write,idempotent,mutation_policy_required,capability_envelope,approval_required,readback,same_cycle_readback,no_execution,no_provider_call,no_external_write,no_secrets',
    updated_at = CURRENT_TIMESTAMP
WHERE tool_key = 'repository_main_moved_event_create';

INSERT INTO execution_policies
  (policy_group, policy_key, policy_value, active, execution_scope, affects_layer, blocking, notes)
VALUES
  (
    'Release Intelligence Governance',
    'repository_main_moved_trigger_policy_v1',
    JSON_OBJECT(
      'rule', 'main_moved_requires_production_sync_before_hostinger_deploy',
      'enforcement_mode', 'blocking',
      'allowlisted_repository_required', true,
      'source_branch', 'main',
      'deployment_branch', 'Production',
      'main_branch_only', true,
      'event_idempotency_required', true,
      'transactional_outbox_required', true,
      'runtime_verification_allowed', true,
      'advisor_planning_allowed', true,
      'production_sync_required_after_main_movement', true,
      'production_sync_action_key', 'release.sync_production_from_latest_main',
      'ci_gate_required', true,
      'typed_merge_approval_required', true,
      'fresh_hostinger_build_required', true,
      'exact_production_merge_sha_readback_required', true,
      'health_readback_required', true,
      'direct_main_to_hostinger_deploy_forbidden', true,
      'ancestry_only_deploy_success_forbidden', true,
      'release_operation_creation_forbidden', true,
      'gate_mutation_forbidden', true,
      'capability_envelope_creation_forbidden', true,
      'job_enqueue_forbidden', true,
      'deploy_forbidden', true,
      'restart_forbidden', true,
      'provider_calls_forbidden', true,
      'external_writes_forbidden', true,
      'execution_allowed', false,
      'typed_approval_required_for_future_execution', true,
      'same_cycle_readback_required', true,
      'secrets_included', false
    ),
    true,
    'repository_main_moved_event_create|repository_main_moved_event_get|gpt_tools_call|tool_dispatch',
    'repositoryMainMovedTriggerService|repositoryMainMovedTriggerRoutes|repository_main_moved_trigger_events|platform_outbox_events|runtime_verification_runs|selfHealingReleaseAdvisorService|release_advisor_runs|runtimeParityStartupReconciler',
    true,
    'Every accepted main movement must produce a governed latest-main to Production synchronization plan. Hostinger release readiness remains blocked until a fresh post-merge build, exact Production merge SHA manifest match, and healthy same-cycle runtime readback pass. The coordinator and advisor never execute the PR, merge, deployment, restart, provider call, migration, external send, or external write.'
  )
ON DUPLICATE KEY UPDATE
  policy_value = VALUES(policy_value),
  active = VALUES(active),
  execution_scope = VALUES(execution_scope),
  affects_layer = VALUES(affects_layer),
  blocking = VALUES(blocking),
  notes = VALUES(notes),
  updated_at = CURRENT_TIMESTAMP;

SELECT
  COLUMN_TYPE AS coordination_status_column_type,
  LOCATE('''production_sync_required''', COLUMN_TYPE) > 0 AS production_sync_status_registered
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'repository_main_moved_trigger_events'
  AND COLUMN_NAME = 'coordination_status';

SELECT
  policy_key,
  JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.source_branch')) AS source_branch,
  JSON_UNQUOTE(JSON_EXTRACT(policy_value, '$.deployment_branch')) AS deployment_branch,
  JSON_EXTRACT(policy_value, '$.production_sync_required_after_main_movement') AS production_sync_required_after_main_movement,
  JSON_EXTRACT(policy_value, '$.fresh_hostinger_build_required') AS fresh_hostinger_build_required,
  JSON_EXTRACT(policy_value, '$.exact_production_merge_sha_readback_required') AS exact_production_merge_sha_readback_required,
  active,
  blocking
FROM execution_policies
WHERE policy_key = 'repository_main_moved_trigger_policy_v1';
