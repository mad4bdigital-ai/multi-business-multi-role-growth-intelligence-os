-- Resolve the remaining five critical operational alerts after live readback.
--
-- Evidence collected before this migration:
-- - Production Hostinger target b49fe2ae-5974-11f1-9baf-8e76a7e1749f is
--   active/valid, uses github_main_auto_deploy, has ssh_path_status=skipped_by_user,
--   ssh_normal_updates_allowed=false, and ssh_break_glass_only=true.
-- - Google Ads execution task 3fa74909-64af-11f1-8ecd-456940024c79 is already
--   done with resolution_classification=policy_disabled_by_design and no
--   activation or spend change was performed.
-- - OpenClaude bridge health reports ready_for_live_provider_dispatch, route_live,
--   provider_dispatch_enabled, live_provider_ready, dispatch_allowed=1,
--   apply_allowed=0, and secrets_included=false.
--
-- Safety contract:
-- - exact task_id and alert_id targeting
-- - current lifecycle/status guards
-- - internal lifecycle persistence only
-- - no provider call
-- - no external write or external send
-- - no credential payload read
-- - no raw secrets
-- - no schema change or destructive SQL
-- - secrets_included=false

UPDATE platform_pending_tasks
SET status = 'done',
    blocker_level = 'none',
    completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
    context_json = JSON_SET(
      COALESCE(context_json, JSON_OBJECT()),
      '$.resolution_classification', 'policy_disabled_by_design',
      '$.resolution_reason', 'google_ads_execution_enablement_intentionally_disabled',
      '$.execution_enablement_task_id', '3fa74909-64af-11f1-8ecd-456940024c79',
      '$.google_ads_connection_required_while_execution_disabled', FALSE,
      '$.connection_setup_performed', FALSE,
      '$.provider_execution_allowed', FALSE,
      '$.provider_call_executed', FALSE,
      '$.spend_change_executed', FALSE,
      '$.migration_provider_call_executed', FALSE,
      '$.migration_external_write_executed', FALSE,
      '$.migration_external_send_executed', FALSE,
      '$.credential_payload_read', FALSE,
      '$.raw_secrets_included', FALSE,
      '$.secrets_included', FALSE
    ),
    updated_by = 'migration:20260722_resolve_remaining_critical_operational_attention',
    updated_at = CURRENT_TIMESTAMP
WHERE task_id = '3fa74049-64af-11f1-8ecd-456940024c79'
  AND task_key = 'ads_governance_google_ads_connection_missing_20260610'
  AND status IN ('pending', 'in_progress', 'blocked', 'deferred');

UPDATE platform_pending_tasks
SET status = 'done',
    blocker_level = 'none',
    completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
    context_json = JSON_SET(
      COALESCE(context_json, JSON_OBJECT()),
      '$.resolution_classification', 'policy_disabled_by_design',
      '$.resolution_reason', 'google_ads_execution_enablement_intentionally_disabled',
      '$.execution_enablement_task_id', '3fa74909-64af-11f1-8ecd-456940024c79',
      '$.budget_preflight_required_while_execution_disabled', FALSE,
      '$.budget_preflight_performed', FALSE,
      '$.provider_execution_allowed', FALSE,
      '$.provider_call_executed', FALSE,
      '$.spend_change_executed', FALSE,
      '$.migration_provider_call_executed', FALSE,
      '$.migration_external_write_executed', FALSE,
      '$.migration_external_send_executed', FALSE,
      '$.credential_payload_read', FALSE,
      '$.raw_secrets_included', FALSE,
      '$.secrets_included', FALSE
    ),
    updated_by = 'migration:20260722_resolve_remaining_critical_operational_attention',
    updated_at = CURRENT_TIMESTAMP
WHERE task_id = '3fa74621-64af-11f1-8ecd-456940024c79'
  AND task_key = 'ads_governance_budget_preflight_not_ready_20260610'
  AND status IN ('pending', 'in_progress', 'blocked', 'deferred');

UPDATE platform_pending_tasks
SET status = 'done',
    blocker_level = 'none',
    completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
    context_json = JSON_SET(
      COALESCE(context_json, JSON_OBJECT()),
      '$.resolution_classification', 'verified_complete',
      '$.resolution_reason', 'openclaude_bridge_ready_for_live_provider_dispatch',
      '$.readiness', 'ready_for_live_provider_dispatch',
      '$.route_live', TRUE,
      '$.provider_dispatch_enabled', TRUE,
      '$.live_provider_ready', TRUE,
      '$.dispatch_allowed', TRUE,
      '$.apply_allowed', FALSE,
      '$.local_execution_requires_explicit_approval', TRUE,
      '$.repo_mutation_allowed', FALSE,
      '$.migration_provider_call_executed', FALSE,
      '$.migration_external_write_executed', FALSE,
      '$.migration_external_send_executed', FALSE,
      '$.credential_payload_read', FALSE,
      '$.raw_secrets_included', FALSE,
      '$.secrets_included', FALSE
    ),
    updated_by = 'migration:20260722_resolve_remaining_critical_operational_attention',
    updated_at = CURRENT_TIMESTAMP
WHERE task_id = '1874d119-5890-11f1-9baf-8e76a7e1749f'
  AND task_key = 'summary_dev_signal:openclaude_provider_bridge_required:v1'
  AND status IN ('pending', 'in_progress', 'blocked', 'deferred');

UPDATE operational_alerts
SET lifecycle_status = 'resolved',
    lifecycle_revision = lifecycle_revision + 1,
    verification_state = 'verified',
    evidence_type = 'superseded_execution_policy_readback',
    evidence_ref = 'target://b49fe2ae-5974-11f1-9baf-8e76a7e1749f',
    evidence_json = JSON_SET(
      COALESCE(evidence_json, JSON_OBJECT()),
      '$.resolution_classification', 'superseded',
      '$.resolution_reason', 'production_uses_github_main_auto_deploy',
      '$.production_target_status', 'active',
      '$.production_target_validation_status', 'valid',
      '$.deployment_strategy', 'github_main_auto_deploy',
      '$.ssh_path_status', 'skipped_by_user',
      '$.ssh_normal_updates_allowed', FALSE,
      '$.ssh_break_glass_only', TRUE,
      '$.retry_required', FALSE,
      '$.migration_provider_call_executed', FALSE,
      '$.migration_external_write_executed', FALSE,
      '$.migration_external_send_executed', FALSE,
      '$.credential_payload_read', FALSE,
      '$.raw_secrets_included', FALSE,
      '$.secrets_included', FALSE
    ),
    lifecycle_actor = 'migration:20260722_resolve_remaining_critical_operational_attention',
    lifecycle_note = 'Resolved historical stale-timeout SSH probe alert after live target readback confirmed GitHub main auto-deploy is the normal production update path and SSH is break-glass only.',
    resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP),
    resolution_note = 'The failed probe is historical and superseded; no retry is required for normal production updates.',
    secrets_included = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE alert_id = '794d27b0-4e22-4098-bed9-662787393255'
  AND source_record_id = 'execution:7a5c16d7b990f62555e98ba46872886def5006d12ecc3a48c79c7fc3ad152383'
  AND lifecycle_status IN ('open', 'acknowledged', 'investigating');

UPDATE operational_alerts
SET lifecycle_status = 'resolved',
    lifecycle_revision = lifecycle_revision + 1,
    verification_state = 'verified',
    evidence_type = 'superseded_execution_policy_readback',
    evidence_ref = 'target://b49fe2ae-5974-11f1-9baf-8e76a7e1749f',
    evidence_json = JSON_SET(
      COALESCE(evidence_json, JSON_OBJECT()),
      '$.resolution_classification', 'superseded',
      '$.resolution_reason', 'ssh_probe_intentionally_disabled_for_normal_updates',
      '$.production_target_status', 'active',
      '$.production_target_validation_status', 'valid',
      '$.deployment_strategy', 'github_main_auto_deploy',
      '$.ssh_path_status', 'skipped_by_user',
      '$.ssh_normal_updates_allowed', FALSE,
      '$.ssh_break_glass_only', TRUE,
      '$.retry_required', FALSE,
      '$.migration_provider_call_executed', FALSE,
      '$.migration_external_write_executed', FALSE,
      '$.migration_external_send_executed', FALSE,
      '$.credential_payload_read', FALSE,
      '$.raw_secrets_included', FALSE,
      '$.secrets_included', FALSE
    ),
    lifecycle_actor = 'migration:20260722_resolve_remaining_critical_operational_attention',
    lifecycle_note = 'Resolved historical disabled SSH probe alert after live target readback confirmed SSH is intentionally skipped for normal production updates.',
    resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP),
    resolution_note = 'The disabled probe is expected policy behavior and is superseded by GitHub main auto-deploy.',
    secrets_included = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE alert_id = '2f9b466d-10a6-40a6-a652-3dc05e4a76fd'
  AND source_record_id = 'execution:9c461e8a25a10bca4e6080335cdc91ffe207894e3aa0e4cb1ba39f93d61b8f60'
  AND lifecycle_status IN ('open', 'acknowledged', 'investigating');

UPDATE operational_alerts
SET lifecycle_status = 'resolved',
    lifecycle_revision = lifecycle_revision + 1,
    verification_state = 'verified',
    evidence_type = 'completed_source_task_readback',
    evidence_ref = 'task://3fa74049-64af-11f1-8ecd-456940024c79',
    evidence_json = JSON_SET(
      COALESCE(evidence_json, JSON_OBJECT()),
      '$.source_task_status', 'done',
      '$.source_task_resolution_classification', 'policy_disabled_by_design',
      '$.source_task_resolution_reason', 'google_ads_execution_enablement_intentionally_disabled',
      '$.execution_activation_performed', FALSE,
      '$.provider_call_executed', FALSE,
      '$.spend_change_executed', FALSE,
      '$.migration_external_write_executed', FALSE,
      '$.migration_external_send_executed', FALSE,
      '$.credential_payload_read', FALSE,
      '$.raw_secrets_included', FALSE,
      '$.secrets_included', FALSE
    ),
    lifecycle_actor = 'migration:20260722_resolve_remaining_critical_operational_attention',
    lifecycle_note = 'Resolved after source task closure confirmed a Google Ads connection is not required while execution remains intentionally disabled by policy.',
    resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP),
    resolution_note = 'No provider activation, credential setup, or spend change was performed.',
    secrets_included = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE alert_id = '6216cf2b-96e3-4cc4-8bc8-4e6b8ae7cf4d'
  AND source_record_id = '3fa74049-64af-11f1-8ecd-456940024c79'
  AND lifecycle_status IN ('open', 'acknowledged', 'investigating');

UPDATE operational_alerts
SET lifecycle_status = 'resolved',
    lifecycle_revision = lifecycle_revision + 1,
    verification_state = 'verified',
    evidence_type = 'completed_source_task_readback',
    evidence_ref = 'task://3fa74621-64af-11f1-8ecd-456940024c79',
    evidence_json = JSON_SET(
      COALESCE(evidence_json, JSON_OBJECT()),
      '$.source_task_status', 'done',
      '$.source_task_resolution_classification', 'policy_disabled_by_design',
      '$.source_task_resolution_reason', 'google_ads_execution_enablement_intentionally_disabled',
      '$.execution_activation_performed', FALSE,
      '$.budget_preflight_performed', FALSE,
      '$.provider_call_executed', FALSE,
      '$.spend_change_executed', FALSE,
      '$.migration_external_write_executed', FALSE,
      '$.migration_external_send_executed', FALSE,
      '$.credential_payload_read', FALSE,
      '$.raw_secrets_included', FALSE,
      '$.secrets_included', FALSE
    ),
    lifecycle_actor = 'migration:20260722_resolve_remaining_critical_operational_attention',
    lifecycle_note = 'Resolved after source task closure confirmed budget preflight is not required while Google Ads execution remains intentionally disabled by policy.',
    resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP),
    resolution_note = 'No budget mutation, provider activation, or spend change was performed.',
    secrets_included = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE alert_id = '0a46b352-18d6-49e2-b8f8-147558d62768'
  AND source_record_id = '3fa74621-64af-11f1-8ecd-456940024c79'
  AND lifecycle_status IN ('open', 'acknowledged', 'investigating');

UPDATE operational_alerts
SET lifecycle_status = 'resolved',
    lifecycle_revision = lifecycle_revision + 1,
    verification_state = 'verified',
    evidence_type = 'completed_source_task_readback',
    evidence_ref = 'task://1874d119-5890-11f1-9baf-8e76a7e1749f',
    evidence_json = JSON_SET(
      COALESCE(evidence_json, JSON_OBJECT()),
      '$.source_task_status', 'done',
      '$.source_task_resolution_classification', 'verified_complete',
      '$.source_task_resolution_reason', 'openclaude_bridge_ready_for_live_provider_dispatch',
      '$.readiness', 'ready_for_live_provider_dispatch',
      '$.route_live', TRUE,
      '$.provider_dispatch_enabled', TRUE,
      '$.live_provider_ready', TRUE,
      '$.dispatch_allowed', TRUE,
      '$.apply_allowed', FALSE,
      '$.repo_mutation_allowed', FALSE,
      '$.migration_provider_call_executed', FALSE,
      '$.migration_external_write_executed', FALSE,
      '$.migration_external_send_executed', FALSE,
      '$.credential_payload_read', FALSE,
      '$.raw_secrets_included', FALSE,
      '$.secrets_included', FALSE
    ),
    lifecycle_actor = 'migration:20260722_resolve_remaining_critical_operational_attention',
    lifecycle_note = 'Resolved after live OpenClaude bridge health readback confirmed readiness for scoped live provider dispatch.',
    resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP),
    resolution_note = 'The governed provider bridge is live and dispatch-ready; apply and repository mutation remain disabled.',
    secrets_included = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE alert_id = '6b1cb6c7-032a-4911-bd37-731064d4073f'
  AND source_record_id = '1874d119-5890-11f1-9baf-8e76a7e1749f'
  AND lifecycle_status IN ('open', 'acknowledged', 'investigating');
