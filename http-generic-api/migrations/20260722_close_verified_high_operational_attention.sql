-- Close nine verified high-severity operational-attention items after live readback.
--
-- Evidence collected before this migration:
-- - GitHub repository-main-moved webhook 655391973 is active for push events,
--   uses JSON content, insecure_ssl=0, passed signature verification, and its
--   provisioning ping delivery returned HTTP 200. The platform credential
--   reference is validated; no credential value is recorded here.
-- - release_operations contains durable verified receipts, including
--   5cdc3adc-2022-4f37-908c-eb5cb3c7339d and
--   19f4be83-af2e-45a0-a9db-3c1a464835c6.
-- - hostinger_deploy_release_apply_policy_v1 is active with operation_intent=deploy.
-- - Production Hostinger target b49fe2ae-5974-11f1-9baf-8e76a7e1749f is
--   active/valid and intentionally uses github_main_auto_deploy; SSH is skipped
--   for normal updates and retained as break-glass only.
-- - OpenClaude bridge readiness is ready_for_live_provider_dispatch with live
--   route and provider dispatch enabled; apply remains disabled.
-- - Google Ads execution remains policy_disabled_by_design and is not activated.
--
-- Safety contract:
-- - internal lifecycle persistence only
-- - no provider call
-- - no external write or send
-- - no credential or secret payload read
-- - no schema change
-- - no destructive SQL
-- - secrets_included=false

UPDATE platform_pending_tasks
SET status = 'done',
    blocker_level = 'none',
    completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
    context_json = JSON_SET(
      COALESCE(context_json, JSON_OBJECT()),
      '$.resolution_classification', 'verified_complete',
      '$.resolution_reason', 'github_repository_main_moved_webhook_configured_and_verified',
      '$.webhook_hook_id', 655391973,
      '$.webhook_status', 'configured',
      '$.webhook_active', TRUE,
      '$.webhook_events', JSON_ARRAY('push'),
      '$.webhook_content_type', 'json',
      '$.webhook_insecure_ssl', '0',
      '$.signature_verified', TRUE,
      '$.ping_delivery_status_code', 200,
      '$.credential_reference_validation_status', 'validated',
      '$.provider_write_completed_before_migration', TRUE,
      '$.migration_provider_call_executed', FALSE,
      '$.migration_external_write_executed', FALSE,
      '$.secrets_included', FALSE
    ),
    updated_by = 'migration:20260722_close_verified_high_operational_attention',
    updated_at = CURRENT_TIMESTAMP
WHERE task_id = '12c6a37f-838b-11f1-9a4d-d342cf4a053c'
  AND task_key = 'credential_intake_completed:05dcfb4f-0f2b-44c2-ac9a-731b69a6d373'
  AND status IN ('pending', 'in_progress', 'blocked', 'deferred');

UPDATE platform_pending_tasks
SET status = 'done',
    blocker_level = 'none',
    completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
    context_json = JSON_SET(
      COALESCE(context_json, JSON_OBJECT()),
      '$.resolution_classification', 'policy_disabled_by_design',
      '$.resolution_reason', 'execution_enablement_intentionally_disabled',
      '$.provider_execution_allowed', FALSE,
      '$.execution_activation_performed', FALSE,
      '$.migration_provider_call_executed', FALSE,
      '$.migration_external_write_executed', FALSE,
      '$.secrets_included', FALSE
    ),
    updated_by = 'migration:20260722_close_verified_high_operational_attention',
    updated_at = CURRENT_TIMESTAMP
WHERE task_id = '3fa74909-64af-11f1-8ecd-456940024c79'
  AND task_key = 'ads_governance_execution_enablement_disabled_20260610'
  AND status IN ('pending', 'in_progress', 'blocked', 'deferred');

UPDATE platform_pending_tasks
SET status = 'done',
    blocker_level = 'none',
    completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
    context_json = JSON_SET(
      COALESCE(context_json, JSON_OBJECT()),
      '$.resolution_classification', 'superseded',
      '$.resolution_reason', 'production_uses_github_main_auto_deploy',
      '$.production_target_id', 'b49fe2ae-5974-11f1-9baf-8e76a7e1749f',
      '$.production_target_status', 'active',
      '$.production_target_validation_status', 'valid',
      '$.deployment_strategy', 'github_main_auto_deploy',
      '$.ssh_path_status', 'skipped_by_user',
      '$.ssh_normal_updates_allowed', FALSE,
      '$.ssh_break_glass_only', TRUE,
      '$.ssh_execution_required_for_normal_updates', FALSE,
      '$.migration_provider_call_executed', FALSE,
      '$.migration_external_write_executed', FALSE,
      '$.secrets_included', FALSE
    ),
    updated_by = 'migration:20260722_close_verified_high_operational_attention',
    updated_at = CURRENT_TIMESTAMP
WHERE task_id = '8fbb84a1-61a9-11f1-8ecd-456940024c79'
  AND task_key = 'hostinger_ssh_target_probe_post_merge_readback'
  AND status IN ('pending', 'in_progress', 'blocked', 'deferred');

UPDATE platform_pending_tasks
SET status = 'done',
    blocker_level = 'none',
    completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
    context_json = JSON_SET(
      COALESCE(context_json, JSON_OBJECT()),
      '$.resolution_classification', 'superseded',
      '$.resolution_reason', 'production_uses_github_main_auto_deploy',
      '$.production_target_id', 'b49fe2ae-5974-11f1-9baf-8e76a7e1749f',
      '$.production_target_status', 'active',
      '$.production_target_validation_status', 'valid',
      '$.deployment_strategy', 'github_main_auto_deploy',
      '$.ssh_path_status', 'skipped_by_user',
      '$.ssh_password_auth_required_for_normal_updates', FALSE,
      '$.ssh_break_glass_only', TRUE,
      '$.migration_provider_call_executed', FALSE,
      '$.migration_external_write_executed', FALSE,
      '$.secrets_included', FALSE
    ),
    updated_by = 'migration:20260722_close_verified_high_operational_attention',
    updated_at = CURRENT_TIMESTAMP
WHERE task_id = 'b7667095-61cd-11f1-8ecd-456940024c79'
  AND task_key = 'hostinger_ssh_password_auth_post_merge_deploy_intake_probe'
  AND status IN ('pending', 'in_progress', 'blocked', 'deferred');

UPDATE platform_pending_tasks
SET status = 'done',
    blocker_level = 'none',
    completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
    context_json = JSON_SET(
      COALESCE(context_json, JSON_OBJECT()),
      '$.resolution_classification', 'superseded',
      '$.resolution_reason', 'credential_handoff_not_required_for_github_main_auto_deploy',
      '$.production_target_id', 'b49fe2ae-5974-11f1-9baf-8e76a7e1749f',
      '$.deployment_strategy', 'github_main_auto_deploy',
      '$.ssh_path_status', 'skipped_by_user',
      '$.credential_intake_required_for_normal_updates', FALSE,
      '$.ssh_break_glass_only', TRUE,
      '$.migration_provider_call_executed', FALSE,
      '$.migration_external_write_executed', FALSE,
      '$.secrets_included', FALSE
    ),
    updated_by = 'migration:20260722_close_verified_high_operational_attention',
    updated_at = CURRENT_TIMESTAMP
WHERE task_id = '527cafca-61b9-11f1-8ecd-456940024c79'
  AND task_key = 'credential_intake_handoff_post_merge_deploy_readback'
  AND status IN ('pending', 'in_progress', 'blocked', 'deferred');

UPDATE platform_pending_tasks
SET status = 'done',
    blocker_level = 'none',
    completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
    context_json = JSON_SET(
      COALESCE(context_json, JSON_OBJECT()),
      '$.resolution_classification', 'superseded',
      '$.resolution_reason', 'ssh_deploy_executor_retained_as_break_glass_not_normal_update_path',
      '$.production_target_id', 'b49fe2ae-5974-11f1-9baf-8e76a7e1749f',
      '$.production_target_status', 'active',
      '$.production_target_validation_status', 'valid',
      '$.deployment_strategy', 'github_main_auto_deploy',
      '$.ssh_normal_updates_allowed', FALSE,
      '$.ssh_break_glass_only', TRUE,
      '$.deploy_executor_required_for_normal_updates', FALSE,
      '$.migration_provider_call_executed', FALSE,
      '$.migration_external_write_executed', FALSE,
      '$.secrets_included', FALSE
    ),
    updated_by = 'migration:20260722_close_verified_high_operational_attention',
    updated_at = CURRENT_TIMESTAMP
WHERE task_id = '22a15347-619d-11f1-8ecd-456940024c79'
  AND task_key = 'hostinger_ssh_deploy_executor_post_merge_deploy_readback'
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
      '$.migration_provider_call_executed', FALSE,
      '$.migration_external_write_executed', FALSE,
      '$.secrets_included', FALSE
    ),
    updated_by = 'migration:20260722_close_verified_high_operational_attention',
    updated_at = CURRENT_TIMESTAMP
WHERE task_id = '90cb38e5-618e-11f1-8ecd-456940024c79'
  AND task_key = 'openclaude_bridge_deploy_transport_repair'
  AND status IN ('pending', 'in_progress', 'blocked', 'deferred');

UPDATE operational_alerts
SET lifecycle_status = 'resolved',
    lifecycle_revision = lifecycle_revision + 1,
    verification_state = 'verified',
    evidence_type = 'release_operation_durable_receipt_readback',
    evidence_ref = 'release-operation://5cdc3adc-2022-4f37-908c-eb5cb3c7339d',
    evidence_json = JSON_SET(
      COALESCE(evidence_json, JSON_OBJECT()),
      '$.resolution_verified', TRUE,
      '$.durable_receipt_operation_id', '5cdc3adc-2022-4f37-908c-eb5cb3c7339d',
      '$.durable_receipt_operation_key', 'release-ledger-smoke-20260713-001',
      '$.durable_receipt_status', 'verified',
      '$.durable_receipt_final_classification', 'verified',
      '$.additional_verified_operation_id', '19f4be83-af2e-45a0-a9db-3c1a464835c6',
      '$.readback_required', TRUE,
      '$.migration_provider_call_executed', FALSE,
      '$.migration_external_write_executed', FALSE,
      '$.secrets_included', FALSE
    ),
    lifecycle_actor = 'migration:20260722_close_verified_high_operational_attention',
    lifecycle_note = 'Resolved after durable release-operation receipts and commit/status readbacks became available.',
    resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP),
    resolution_note = 'Durable deployment receipt coverage is active. Verified release-operation records now preserve status, commit and final-classification evidence independently of transient HTTP 503 responses.',
    secrets_included = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE alert_id = '150a4ebd-6b16-11f1-8ecd-456940024c79'
  AND alert_key = 'known.hostinger_restart_transient_503'
  AND lifecycle_status IN ('open', 'acknowledged', 'investigating');

UPDATE operational_alerts
SET lifecycle_status = 'resolved',
    lifecycle_revision = lifecycle_revision + 1,
    verification_state = 'verified',
    evidence_type = 'active_apply_policy_readback',
    evidence_ref = 'policy://hostinger_deploy_release_apply_policy_v1',
    evidence_json = JSON_SET(
      COALESCE(evidence_json, JSON_OBJECT()),
      '$.resolution_verified', TRUE,
      '$.active_policy_key', 'hostinger_deploy_release_apply_policy_v1',
      '$.active_capability_key', 'remote_runtime_hostinger_deploy_release',
      '$.active_runtime_surface', 'remote_runtime_hostinger_deploy_release',
      '$.active_operation_intent', 'deploy',
      '$.policy_status', 'active',
      '$.migration_provider_call_executed', FALSE,
      '$.migration_external_write_executed', FALSE,
      '$.secrets_included', FALSE
    ),
    lifecycle_actor = 'migration:20260722_close_verified_high_operational_attention',
    lifecycle_note = 'Resolved after live policy readback confirmed the governed deploy operation intent is deploy.',
    resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP),
    resolution_note = 'The active Hostinger deploy apply policy now requires operation_intent=deploy; the historical deploy_release mismatch is no longer present in the active contract.',
    secrets_included = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE alert_id = '150a48ac-6b16-11f1-8ecd-456940024c79'
  AND alert_key = 'known.deploy_operation_intent_mismatch'
  AND lifecycle_status IN ('open', 'acknowledged', 'investigating');
